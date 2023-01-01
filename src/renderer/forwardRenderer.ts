import { Camera, FreeControlledCamera } from "./camera";
import { IDirectionalLight, Renderable, Renderer } from "./renderer";
import shader from "./forward.wgsl";
import { SimpleShadowRenderer } from "./simpleShadowRenderer";
import { CSMShadowRenderer } from "./csmShadowRenderer";
import { preprocess } from "../preprocessor/preprocessor";

export class ForwardRenderer {
    private device: GPUDevice;
    private context: GPUCanvasContext;
    private presentationSize: [number, number];
    private presentationFormat: GPUTextureFormat;

    private perFrameBindGroupLayout: GPUBindGroupLayout;
    private perRenderableBindGroupLayout: GPUBindGroupLayout;

    private forwardRenderPipeline: GPURenderPipeline;

    private cameraBuffer: GPUBuffer;
    private lightBuffer: GPUBuffer;
    private perFrameBindGroup: GPUBindGroup;

    private msaaTarget: GPUTexture;
    private depthBuffer: GPUTexture;

    private viewCamera?: Camera;

    private directionalLightData!: IDirectionalLight;

    private shadowRenderer: SimpleShadowRenderer | CSMShadowRenderer;
    private useCSM = false;
    private lightBufferInfo = new Map<string, number>();
    private debug_showCascades = false;
    private shadowMode: "simple" | "CSM" = "simple";

    private msaaSampleCount = 4;

    private shadowMapParametersBuffer: GPUBuffer;
    private shadowMapParameters = {
        minBias: -1,
        maxBias: -1,
        pcfSamples: 9,
    };

    private mainRenderer: Renderer;

    constructor(
        mainRenderer: Renderer,
        device: GPUDevice,
        context: GPUCanvasContext,
        presentationSize: [number, number],
        presentatitonFormat: GPUTextureFormat
    ) {
        this.mainRenderer = mainRenderer;
        this.device = device;
        this.context = context;
        this.presentationSize = presentationSize;
        this.presentationFormat = presentatitonFormat;

        this.registerControllers(mainRenderer.getControllerGUI());

        ({
            perFrameBindGroupLayout: this.perFrameBindGroupLayout,
            perRenderableBindGroupLayout: this.perRenderableBindGroupLayout,
        } = this.createBindGroupLayouts());

        // Depth buffer
        this.depthBuffer = device.createTexture({
            size: this.presentationSize,
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            sampleCount: this.msaaSampleCount,
        });

        // Pipeline
        this.forwardRenderPipeline = this.createForwardRenderingPipeline(
            [this.perFrameBindGroupLayout, this.perRenderableBindGroupLayout],
            this.useCSM
        );

        this.shadowRenderer = new SimpleShadowRenderer(
            mainRenderer,
            this.device,
            this.perRenderableBindGroupLayout
        );
        this.shadowRenderer.resolutionChangeListener.push(this);

        // Per frame bind group
        ({
            perFrameBindGroup: this.perFrameBindGroup,
            cameraBuffer: this.cameraBuffer,
            lightBuffer: this.lightBuffer,
            shadowMapParametersBuffer: this.shadowMapParametersBuffer,
            lightBufferStructInfo: this.lightBufferInfo,
        } = this.createPerFrameBindGroupAndBuffers(
            this.perFrameBindGroupLayout,
            this.shadowRenderer.getShadowMapViewAndSampler().view,
            this.shadowRenderer.getShadowMapViewAndSampler().sampler
        ));
        this.updateShadowMappingBuffer();

        // multisample target
        this.msaaTarget = device.createTexture({
            size: this.presentationSize,
            format: this.presentationFormat,
            sampleCount: this.msaaSampleCount,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this.directionalLight = {
            ambientIntensity: 0.05,
            color: [1, 1, 1],
            direction: [0, -1, 0],
        };
    }

    set camera(camera: Camera) {
        this.viewCamera = camera;
        this.shadowRenderer.setCamera(camera);
    }

    registerControllers(gui: dat.GUI) {
        const folder = gui.addFolder("forward renderer");
        folder
            .add(this.shadowMapParameters, "pcfSamples", [0, 9, 25, 49, 81])
            .onChange(() => this.updateShadowMappingBuffer());
        folder
            .add(this, "shadowMode", ["simple", "CSM"])
            .onFinishChange(() => this.onShadowModeChanged());
        folder.add(this, "debug_showCascades", false).onChange((value) => {
            const showCascadeOffset =
                this.lightBufferInfo.get("debug_showCascades");
            if (showCascadeOffset != null) {
                this.device.queue.writeBuffer(
                    this.lightBuffer,
                    showCascadeOffset,
                    new Float32Array([value === true ? 1.0 : 0.0])
                );
            }
        });
        folder.close();
    }

    private structInfo(elements: [number, number, string?][]) {
        const result = {
            entries: new Map<string, number>(),
            structSize: 0,
        };
        let maxAlignment = 0;
        let offset = 0;
        for (let element of elements) {
            const size = element[0];
            const alignment = element[1];
            const elemName = element[2];

            maxAlignment = Math.max(maxAlignment, alignment);

            if (offset % alignment != 0) {
                // Does not match required alignment
                offset += Math.ceil(offset / alignment) * alignment; // next multiple of alignment
            }

            // add entry in result map
            if (elemName != null) {
                result.entries.set(elemName, offset);
            }

            offset += size;
        }

        result.structSize = Math.ceil(offset / maxAlignment) * maxAlignment;
        return result;
    }

    onResolutionChanged() {
        ({
            perFrameBindGroup: this.perFrameBindGroup,
            cameraBuffer: this.cameraBuffer,
            lightBuffer: this.lightBuffer,
        } = this.createPerFrameBindGroupAndBuffers(
            this.perFrameBindGroupLayout,
            this.shadowRenderer.getShadowMapViewAndSampler().view,
            this.shadowRenderer.getShadowMapViewAndSampler().sampler,
            this.cameraBuffer,
            this.lightBuffer
        ));
    }

    onShadowModeChanged() {
        this.useCSM = this.shadowMode === "CSM";

        // recreate layouts
        ({
            perFrameBindGroupLayout: this.perFrameBindGroupLayout,
            perRenderableBindGroupLayout: this.perRenderableBindGroupLayout,
        } = this.createBindGroupLayouts());

        // recreate pipeline
        this.forwardRenderPipeline = this.createForwardRenderingPipeline(
            [this.perFrameBindGroupLayout, this.perRenderableBindGroupLayout],
            this.useCSM
        );

        // create appropriate shadow renderer
        const prevShadowRenderer = this.shadowRenderer;
        this.shadowRenderer.destroy();
        if (this.shadowMode === "CSM") {
            this.shadowRenderer = new CSMShadowRenderer(
                this.mainRenderer,
                this.device,
                this.perRenderableBindGroupLayout,
                prevShadowRenderer
            );
        } else {
            this.shadowRenderer = new SimpleShadowRenderer(
                this.mainRenderer,
                this.device,
                this.perRenderableBindGroupLayout,
                prevShadowRenderer
            );
        }
        this.shadowRenderer.resolutionChangeListener.push(this);

        // recreate per frame bind group and light buffer
        ({
            perFrameBindGroup: this.perFrameBindGroup,
            cameraBuffer: this.cameraBuffer,
            lightBuffer: this.lightBuffer,
            shadowMapParametersBuffer: this.shadowMapParametersBuffer,
            lightBufferStructInfo: this.lightBufferInfo,
        } = this.createPerFrameBindGroupAndBuffers(
            this.perFrameBindGroupLayout,
            this.shadowRenderer.getShadowMapViewAndSampler().view,
            this.shadowRenderer.getShadowMapViewAndSampler().sampler,
            this.cameraBuffer
        ));

        // prettier-ignore
        this.device.queue.writeBuffer(this.lightBuffer, this.lightBufferInfo.get("direction") ?? 0, new Float32Array([
                ...this.directionalLightData.direction, 0, // direction is vec4
                ...this.directionalLightData.color, 1, // color is vec4
                this.directionalLightData.ambientIntensity
            ]));
        this.shadowRenderer.setDirectionalLight(
            this.directionalLight,
            this.lightBuffer
        );
        if (this.viewCamera != null) {
            this.shadowRenderer.setCamera(this.viewCamera);
        }
    }

    private updateShadowMappingBuffer() {
        this.device.queue.writeBuffer(
            this.shadowMapParametersBuffer,
            0,
            new Float32Array([
                this.shadowMapParameters.minBias,
                this.shadowMapParameters.maxBias,
                (Math.sqrt(this.shadowMapParameters.pcfSamples) - 1) / 2,
            ])
        );
    }

    private createBindGroupLayouts() {
        const perFrameBindGroupLayout = this.device.createBindGroupLayout({
            label: "per frame bind group layout",
            entries: [
                {
                    // Camera
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: {
                        type: "uniform",
                        minBindingSize: this.structInfo([
                            [64, 16],
                            [16, 16],
                        ]).structSize,
                    },
                },
                {
                    // Light
                    binding: this.useCSM ? 5 : 1,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: {
                        type: "uniform",
                    },
                },
                {
                    // Shadow map
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {
                        sampleType: "depth",
                    },
                },
                {
                    // Shadow comparison sampler
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {
                        type: "comparison",
                    },
                },
                {
                    // shadow mapping params
                    binding: 4,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: {
                        type: "uniform",
                    },
                },
            ],
        });

        const perRenderableBindGroupLayout = this.device.createBindGroupLayout({
            label: "per frame bind group layout",
            entries: [
                {
                    // Renderable
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: {
                        type: "uniform",
                        minBindingSize: this.structInfo([
                            [64, 16],
                            [64, 16],
                            [16, 16],
                            [4, 4],
                            [4, 4],
                        ]).structSize,
                    },
                },
            ],
        });

        return { perFrameBindGroupLayout, perRenderableBindGroupLayout };
    }

    private createForwardRenderingPipeline(
        layouts: GPUBindGroupLayout[],
        useCSM: boolean
    ) {
        const device = this.device;

        // load shaders
        const shaderModule = device.createShaderModule({
            label: "shader module",
            code: preprocess(shader, {}, { useCSM }),
        });

        const forwardPipelineDescr: GPURenderPipelineDescriptor = {
            label: "render pipeline forward",
            layout: device.createPipelineLayout({
                bindGroupLayouts: layouts,
            }),
            vertex: {
                module: shaderModule,
                entryPoint: "vertexShader",
                buffers: [
                    {
                        // vertex positions
                        arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT, // xyz per vertex
                        stepMode: "vertex",
                        attributes: [
                            {
                                shaderLocation: 0,
                                format: "float32x3",
                                offset: 0,
                            },
                        ],
                    },
                    {
                        // vertex normals
                        arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT, // xyz per vertex
                        stepMode: "vertex",
                        attributes: [
                            {
                                shaderLocation: 1,
                                format: "float32x3",
                                offset: 0,
                            },
                        ],
                    },
                ],
            },
            fragment: {
                module: shaderModule,
                entryPoint: "fragmentShader",
                targets: [
                    {
                        format: this.presentationFormat,
                    },
                ],
            },
            primitive: {
                topology: "triangle-list",
                cullMode: "back",
            },
            depthStencil: {
                format: this.depthBuffer.format,
                depthWriteEnabled: true,
                depthCompare: "less",
            },
            multisample: {
                count: this.msaaSampleCount,
            },
        };

        return device.createRenderPipeline(forwardPipelineDescr);
    }

    private createPerFrameBindGroupAndBuffers(
        layout: GPUBindGroupLayout,
        shadowMapView: GPUTextureView,
        shadowMapSampler: GPUSampler,
        existingCameraBuffer?: GPUBuffer,
        existingLightBuffer?: GPUBuffer
    ) {
        let cameraBuffer: GPUBuffer;
        if (existingCameraBuffer == null) {
            cameraBuffer = this.device.createBuffer({
                label: "camera buffer",
                size: this.structInfo([
                    [64, 16],
                    [16, 16],
                ]).structSize, // view projection + position
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                mappedAtCreation: false,
            });
        } else {
            cameraBuffer = existingCameraBuffer;
        }

        let lightBufferStructInfo: Map<string, number> = new Map<
            string,
            number
        >();
        let lightBuffer: GPUBuffer;
        if (existingLightBuffer == null) {
            if (this.useCSM) {
                const structInfo = this.structInfo([
                    [64 * 4, 4 * 16, "viewProjectionMatrix"], // TODO hardcoded num of cascades
                    [16, 16, "direction"],
                    [16, 16, "color"],
                    [4, 4, "ambientIntensity"],
                    [4, 4, "debug_showCascades"],
                ]);
                lightBufferStructInfo = structInfo.entries;
                lightBuffer = this.device.createBuffer({
                    label: "csmLightBuffer",
                    size: structInfo.structSize,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                    mappedAtCreation: false,
                });
            } else {
                const structInfo = this.structInfo([
                    [64, 16, "viewProjectionMatrix"],
                    [16, 16, "direction"],
                    [16, 16, "color"],
                    [4, 4, "ambientIntensity"],
                ]);
                lightBufferStructInfo = structInfo.entries;
                lightBuffer = this.device.createBuffer({
                    label: "light buffer",
                    size: structInfo.structSize,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                    mappedAtCreation: false,
                });
            }
        } else {
            lightBuffer = existingLightBuffer;
        }

        let shadowMapParametersBuffer: GPUBuffer;
        if (this.shadowMapParametersBuffer == null) {
            shadowMapParametersBuffer = this.device.createBuffer({
                label: "shadow map params buffer",
                size: this.structInfo([
                    [4, 4], // min bias
                    [4, 4], // max bias
                    [4, 4], // pcf samples
                ]).structSize,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                mappedAtCreation: false,
            });
        } else {
            shadowMapParametersBuffer = this.shadowMapParametersBuffer;
        }

        const entries = [
            {
                binding: 0,
                resource: {
                    buffer: cameraBuffer,
                },
            },
            {
                binding: 2,
                resource: shadowMapView,
            },
            {
                binding: 3,
                resource: shadowMapSampler,
            },
            {
                binding: 4,
                resource: {
                    buffer: shadowMapParametersBuffer,
                },
            },
            {
                binding: this.useCSM ? 5 : 1, // pick binding based on what shadow mapping technique we are using
                resource: {
                    buffer: lightBuffer,
                },
            },
        ];
        const perFrameBindGroup = this.device.createBindGroup({
            label: "per frame bind group",
            layout: layout,
            entries: entries,
        });

        return {
            perFrameBindGroup,
            cameraBuffer,
            lightBuffer,
            shadowMapParametersBuffer,
            lightBufferStructInfo,
        };
    }

    private createPerRenderableBindGroupAndBuffers(layout: GPUBindGroupLayout) {
        const renderablePropertiesBuffer = this.device.createBuffer({
            label: "renderable properties buffer",
            size: this.structInfo([
                [64, 16],
                [64, 16],
                [16, 16],
                [4, 4],
                [4, 4],
            ]).structSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            mappedAtCreation: false,
        });

        const perRenderableBindGroup = this.device.createBindGroup({
            label: "per renderable bind group",
            layout: layout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: renderablePropertiesBuffer,
                    },
                },
            ],
        });

        return { perRenderableBindGroup, renderablePropertiesBuffer };
    }

    private updateCameraBuffer(camera: Camera) {
        this.device.queue.writeBuffer(
            this.cameraBuffer,
            0,
            new Float32Array([
                ...camera.getViewProjectionMatrix(),
                ...camera.position,
            ])
        );
    }

    private updateRenderableBuffer(renderable: Renderable) {
        this.device.queue.writeBuffer(
            renderable.propertiesBuffer,
            0,
            // prettier-ignore
            new Float32Array([
                ...renderable.getModelMatrix(),
                ...renderable.getModelMatrixNormals(),
                ...renderable.color, 1,
                renderable.shininess,
                renderable.specularIntensity
            ])
        );
    }

    addRenderable(renderable: Renderable) {
        ({
            perRenderableBindGroup: renderable.bindGroup,
            renderablePropertiesBuffer: renderable.propertiesBuffer,
        } = this.createPerRenderableBindGroupAndBuffers(
            this.perRenderableBindGroupLayout
        ));
    }

    get directionalLight() {
        return { ...this.directionalLightData };
    }

    set directionalLight(light: IDirectionalLight) {
        this.directionalLightData = { ...light };

        // prettier-ignore
        this.device.queue.writeBuffer(this.lightBuffer, this.lightBufferInfo.get("direction") ?? 0, new Float32Array([
                ...this.directionalLightData.direction, 0, // direction is vec4
                ...this.directionalLightData.color, 1, // color is vec4
                this.directionalLightData.ambientIntensity
            ]));

        this.shadowRenderer.setDirectionalLight(light, this.lightBuffer);
    }

    render(renderList: Renderable[], commandEncoder: GPUCommandEncoder) {
        // TODO only do on demand
        for (let renderable of renderList) {
            if (renderable.isDirty) {
                this.updateRenderableBuffer(renderable);
                renderable.isDirty = false;
            }
        }

        if (
            this.shadowMapParameters.minBias !=
                this.shadowRenderer.getMinBias() ||
            this.shadowMapParameters.maxBias != this.shadowRenderer.getMaxBias()
        ) {
            this.shadowMapParameters.minBias = this.shadowRenderer.getMinBias();
            this.shadowMapParameters.maxBias = this.shadowRenderer.getMaxBias();
            this.updateShadowMappingBuffer();
        }
        this.shadowRenderer.render(renderList, commandEncoder);

        if (this.viewCamera != null) {
            (this.viewCamera as FreeControlledCamera).updateAndGetViewMatrix();
            this.updateCameraBuffer(this.viewCamera);
        }

        const passEncoder = commandEncoder.beginRenderPass({
            label: "forward render pass",
            colorAttachments: [
                {
                    loadOp: "clear",
                    clearValue: [0.53, 0.81, 0.98, 1],
                    storeOp: "store",
                    view: this.msaaTarget.createView(),
                    resolveTarget: this.context
                        .getCurrentTexture()
                        .createView(),
                },
            ],
            depthStencilAttachment: {
                view: this.depthBuffer.createView(),
                depthClearValue: 1,
                depthLoadOp: "clear",
                depthStoreOp: "store",
                stencilClearValue: 0,
            },
        });
        passEncoder.setPipeline(this.forwardRenderPipeline);
        passEncoder.setBindGroup(0, this.perFrameBindGroup);

        for (let renderable of renderList) {
            passEncoder.setBindGroup(1, renderable.bindGroup);

            passEncoder.setVertexBuffer(0, renderable.getPositionsBuffer());
            passEncoder.setVertexBuffer(1, renderable.getNormalsBuffer());
            passEncoder.setIndexBuffer(renderable.getIndexBuffer(), "uint32");
            passEncoder.drawIndexed(renderable.getNumIndices(), 1);
        }
        passEncoder.end();
    }
}
