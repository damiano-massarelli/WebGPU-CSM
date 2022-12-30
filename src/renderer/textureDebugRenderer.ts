import { preprocess } from "../preprocessor/preprocessor";
import shader from "./debugTexture.wgsl";

export class TextureDebugRenderer {
    private pipeline: GPURenderPipeline;
    private context: GPUCanvasContext;
    private textureView: GPUTextureView | null;
    private sampler: GPUSampler;
    private device: GPUDevice;
    private bindGroup?: GPUBindGroup;

    constructor(
        device: GPUDevice,
        context: GPUCanvasContext,
        presentationFormat: GPUTextureFormat
    ) {
        this.context = context;
        this.textureView = null;
        this.device = device;

        const shaderModule = device.createShaderModule({
            label: "debug shader module",
            code: preprocess(shader),
        });

        const pipelineDesc: GPURenderPipelineDescriptor = {
            label: "debug texture renderer",
            layout: "auto",
            vertex: {
                module: shaderModule,
                entryPoint: "vertexShader",
            },
            fragment: {
                module: shaderModule,
                entryPoint: "fragmentShader",
                targets: [
                    {
                        format: presentationFormat,
                    },
                ],
            },
            primitive: {
                topology: "triangle-strip",
                cullMode: "none",
            },
        };

        this.pipeline = device.createRenderPipeline(pipelineDesc);

        this.sampler = device.createSampler({
            label: "debug sampler",
        });
    }

    setTexture(textureView: GPUTextureView | null) {
        this.textureView = textureView;

        if (textureView === null) {
            return;
        }

        this.bindGroup = this.device.createBindGroup({
            label: "debug bind group",
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: textureView,
                },
                {
                    binding: 1,
                    resource: this.sampler,
                },
            ],
        });
    }

    render(commandEncoder: GPUCommandEncoder) {
        if (this.textureView == null || this.bindGroup == null) {
            return;
        }

        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    loadOp: "load",
                    clearValue: [0.53, 0.81, 0.98, 1],
                    storeOp: "store",
                    view: this.context.getCurrentTexture().createView(),
                },
            ],
        });

        renderPass.setPipeline(this.pipeline);
        renderPass.setBindGroup(0, this.bindGroup);
        renderPass.draw(4);
        renderPass.end();
    }
}
