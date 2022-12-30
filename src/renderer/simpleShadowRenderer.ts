import { mat4, vec3 } from "gl-matrix";
import { preprocess } from "../preprocessor/preprocessor";
import { Camera } from "./camera";
import { IDirectionalLight, Renderable, Renderer } from "./renderer";
import shader from "./simpleShadow.wgsl";

export interface SimpleShadowRendererResolutionChangeListener {
    onResolutionChanged(newResolution: number): unknown;
}

export class SimpleShadowRenderer {
    private device: GPUDevice;

    private shadowMapTexture: GPUTexture;
    private shadowMapTextureView: GPUTextureView;
    private shadowMapSampler: GPUSampler;

    private shadowRendererPipeline: GPURenderPipeline;

    private lightBuffer?: GPUBuffer;
    private perFrameBindGroupLayout: GPUBindGroupLayout;
    private perFrameBindGroup?: GPUBindGroup;

    private perRenderableBindGroupLayout: GPUBindGroupLayout;

    private camera?: Camera;
    private directionalLightData?: IDirectionalLight;

    private shadowDepthPercentage = 1;
    private shadowMapResolution = 2048;
    private followCameraFrustum = true;
    private lastCameraFrustumCorners?: vec3[];

    public resolutionChangeListener: SimpleShadowRendererResolutionChangeListener[] =
        [];

    private backfaceCulling = true;

    private mainRenderer: Renderer;
    private guiFolder?: dat.GUI;

    constructor(
        mainRenderer: Renderer,
        device: GPUDevice,
        perRenderableBindGroupLayout: GPUBindGroupLayout
    ) {
        this.device = device;
        this.mainRenderer = mainRenderer;

        this.registerControllers(mainRenderer.getControllerGUI());

        ({
            shadowMapTexture: this.shadowMapTexture,
            shadowMapTextureView: this.shadowMapTextureView,
            shadowMapSampler: this.shadowMapSampler,
        } = this.createShadowMapAndSampler([
            this.shadowMapResolution,
            this.shadowMapResolution,
        ]));

        this.mainRenderer
            .getTextureDebugRenderer()
            ?.setTexture(this.shadowMapTextureView);

        this.perFrameBindGroupLayout = this.createPerFrameBindGroupLayout();
        this.perRenderableBindGroupLayout = perRenderableBindGroupLayout;

        this.shadowRendererPipeline = this.createShadowRendererPipeline(
            [this.perFrameBindGroupLayout, perRenderableBindGroupLayout],
            "back"
        );
    }

    registerControllers(gui: dat.GUI) {
        const folder = gui.addFolder("simple shadow renderer");
        folder.add(this, "shadowDepthPercentage", 0, 1);
        folder
            .add(
                this,
                "shadowMapResolution",
                [256, 512, 1024, 2048, 4096, 8192]
            )
            .onChange((val) => this.setShadowMapResolution(val));
        folder.add(this, "followCameraFrustum", true).onChange(() => {
            this.lastCameraFrustumCorners = this.camera?.getWorldSpaceCorners(
                0,
                this.shadowDepthPercentage
            );
        });
        folder
            .add(this, "backfaceCulling", true)
            .onChange(() => this.onFaceCullingChanged());
        folder.close();

        this.guiFolder = folder;
    }

    private onFaceCullingChanged() {
        const cullMode: GPUCullMode = this.backfaceCulling ? "back" : "front";
        this.shadowRendererPipeline = this.createShadowRendererPipeline(
            [this.perFrameBindGroupLayout, this.perRenderableBindGroupLayout],
            cullMode
        );
    }

    setShadowMapResolution(newResolution: number) {
        console.log(newResolution);
        this.shadowMapResolution = newResolution;

        ({
            shadowMapTexture: this.shadowMapTexture,
            shadowMapTextureView: this.shadowMapTextureView,
            shadowMapSampler: this.shadowMapSampler,
        } = this.createShadowMapAndSampler([
            this.shadowMapResolution,
            this.shadowMapResolution,
        ]));

        this.mainRenderer
            .getTextureDebugRenderer()
            ?.setTexture(this.shadowMapTextureView);

        this.resolutionChangeListener.forEach((listener) =>
            listener.onResolutionChanged(newResolution)
        );
    }

    setCamera(camera: Camera) {
        this.camera = camera;
    }

    setDirectionalLight(
        directionalLight: IDirectionalLight,
        lightBuffer: GPUBuffer
    ) {
        this.directionalLightData = { ...directionalLight };
        this.lightBuffer = lightBuffer;

        this.perFrameBindGroup = this.createPerFrameBindGroup(
            this.perFrameBindGroupLayout,
            lightBuffer
        );
    }

    getShadowMapViewAndSampler() {
        return {
            view: this.shadowMapTextureView,
            sampler: this.shadowMapSampler,
        };
    }

    createShadowRendererPipeline(
        layouts: GPUBindGroupLayout[],
        cullMode: GPUCullMode
    ) {
        // load shaders
        const shaderModule = this.device.createShaderModule({
            label: "simple shadow shader module",
            code: preprocess(shader),
        });

        const forwardPipelineDescr: GPURenderPipelineDescriptor = {
            label: "render pipeline shadow simple",
            layout: this.device.createPipelineLayout({
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
                ],
            },
            primitive: {
                topology: "triangle-list",
                cullMode: cullMode,
            },
            depthStencil: {
                format: this.shadowMapTexture.format,
                depthWriteEnabled: true,
                depthCompare: "less",
            },
        };

        return this.device.createRenderPipeline(forwardPipelineDescr);
    }

    createShadowMapAndSampler(size: [number, number]) {
        const shadowMapTexture = this.device.createTexture({
            label: "shadow map texture",
            format: "depth32float",
            size: [...size, 1],
            usage:
                GPUTextureUsage.RENDER_ATTACHMENT |
                GPUTextureUsage.TEXTURE_BINDING,
        });

        const shadowMapTextureView = shadowMapTexture.createView();
        const shadowMapSampler = this.device.createSampler({
            label: "shadow map sampler",
            compare: "less",
            magFilter: "linear",
            minFilter: "linear",
        });

        return { shadowMapTexture, shadowMapTextureView, shadowMapSampler };
    }

    createPerFrameBindGroupLayout() {
        return this.device.createBindGroupLayout({
            label: "per frame bind group layout - shadow",
            entries: [
                {
                    // Light
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: {
                        type: "uniform",
                    },
                },
            ],
        });
    }

    createPerFrameBindGroup(
        layout: GPUBindGroupLayout,
        lightBuffer: GPUBuffer
    ) {
        const perFrameBindGroup = this.device.createBindGroup({
            label: "per frame bind group - shadow",
            layout: layout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: lightBuffer,
                    },
                },
            ],
        });

        return perFrameBindGroup;
    }

    getLightViewProjection() {
        if (this.camera == null || this.directionalLightData == null) {
            return mat4.create();
        }

        let corners = this.camera.getWorldSpaceCorners(
            0,
            this.shadowDepthPercentage
        );
        if (
            this.lastCameraFrustumCorners != null &&
            !this.followCameraFrustum
        ) {
            corners = this.lastCameraFrustumCorners;
        }

        const center = vec3.clone(corners[0]);
        for (let i = 1; i < 8; ++i) {
            vec3.add(center, center, corners[i]);
        }
        vec3.scale(center, center, 1 / 8);

        // view matrix: look at in the direction of the light
        const viewPos = vec3.create();
        vec3.add(viewPos, center, this.directionalLightData.direction);
        const viewMatrix = mat4.create();
        mat4.lookAt(viewMatrix, center, viewPos, vec3.fromValues(0, 1, 0));

        // projection matrix: ortho that takes
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;

        for (let i = 0; i < 8; ++i) {
            const viewSpaceCorner = vec3.create();
            vec3.transformMat4(viewSpaceCorner, corners[i], viewMatrix);
            minX = Math.min(viewSpaceCorner[0], minX);
            minY = Math.min(viewSpaceCorner[1], minY);
            minZ = Math.min(viewSpaceCorner[2], minZ);
            maxX = Math.max(viewSpaceCorner[0], maxX);
            maxY = Math.max(viewSpaceCorner[1], maxY);
            maxZ = Math.max(viewSpaceCorner[2], maxZ);
        }

        const projMatrix = mat4.create();
        mat4.orthoZO(projMatrix, minX, maxX, minY, maxY, minZ, maxZ);

        const result = mat4.create();
        mat4.mul(result, projMatrix, viewMatrix);
        return result;
    }

    render(renderList: Renderable[], commandEncoder: GPUCommandEncoder) {
        if (this.lightBuffer != null) {
            const lightViewProj: mat4 = this.getLightViewProjection();
            this.device.queue.writeBuffer(
                this.lightBuffer,
                0,
                new Float32Array([...lightViewProj])
            );
        }

        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [],
            depthStencilAttachment: {
                view: this.shadowMapTextureView,
                depthClearValue: 1,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
        });

        passEncoder.setPipeline(this.shadowRendererPipeline);
        passEncoder.setBindGroup(0, this.perFrameBindGroup!);

        for (let renderable of renderList) {
            passEncoder.setBindGroup(1, renderable.bindGroup);

            passEncoder.setVertexBuffer(0, renderable.getPositionsBuffer());
            passEncoder.setVertexBuffer(1, renderable.getNormalsBuffer());
            passEncoder.setIndexBuffer(renderable.getIndexBuffer(), "uint32");
            passEncoder.drawIndexed(renderable.getNumIndices(), 1);
        }
        passEncoder.end();
    }

    destroy() {
        this.lightBuffer?.destroy();
        this.shadowMapTexture.destroy();
        if (this.guiFolder != null) {
            this.mainRenderer.getControllerGUI().removeFolder(this.guiFolder);
        }
        this.mainRenderer.getTextureDebugRenderer()?.setTexture(null);
    }
}
