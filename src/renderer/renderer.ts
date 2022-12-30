import { mat3, mat4, quat, vec3 } from "gl-matrix";
import { Camera, FreeControlledCamera } from "./camera";
import { ForwardRenderer } from "./forwardRenderer";

import * as dat from "dat.gui";
import { TextureDebugRenderer } from "./textureDebugRenderer";

export class Renderable {
    public position: vec3;
    public rotation: quat;
    public scale: vec3;

    public color: vec3;
    public shininess: number;
    public specularIntensity: number;

    public isDirty: boolean;
    private numIndices: number;
    private positionsBuffer: GPUBuffer;
    private normalsBuffer: GPUBuffer;
    private indexBuffer: GPUBuffer;
    public bindGroup!: GPUBindGroup;
    public propertiesBuffer!: GPUBuffer;

    constructor(
        positionsBuffer: GPUBuffer,
        normalsBuffer: GPUBuffer,
        indexBuffer: GPUBuffer,
        numIndices: number
    ) {
        this.position = vec3.create();
        this.rotation = quat.create();
        this.scale = vec3.fromValues(1, 1, 1);

        this.color = vec3.fromValues(1, 1, 1);
        this.shininess = 10;
        this.specularIntensity = 1;

        this.positionsBuffer = positionsBuffer;
        this.normalsBuffer = normalsBuffer;
        this.indexBuffer = indexBuffer;
        this.numIndices = numIndices;
        this.isDirty = true;
    }

    getModelMatrix(): mat4 {
        const model = mat4.create();
        mat4.fromRotationTranslationScale(
            model,
            this.rotation,
            this.position,
            this.scale
        );
        return model;
    }

    getModelMatrixNormals(): mat4 {
        const modelForNormals = mat4.create();
        mat4.transpose(modelForNormals, this.getModelMatrix());
        mat4.invert(modelForNormals, modelForNormals);
        return modelForNormals;
    }

    getIndexBuffer(): GPUBuffer {
        return this.indexBuffer;
    }

    getPositionsBuffer(): GPUBuffer {
        return this.positionsBuffer;
    }

    getNormalsBuffer(): GPUBuffer {
        return this.normalsBuffer;
    }

    getNumIndices() {
        return this.numIndices;
    }
}

export interface IDirectionalLight {
    direction: vec3;
    color: vec3;
    ambientIntensity: number;
}

export interface IGeometryData {
    positions: number[];
    normals: number[];
    indices: number[];
}

export class Renderer {
    private presentationSize: [number, number];
    private context: GPUCanvasContext | null;
    private device: GPUDevice | undefined;
    private presentationFormat: GPUTextureFormat;
    private renderList: Renderable[];
    private camera!: Camera;
    private controllerGUI: dat.GUI;

    private forwardRenderer?: ForwardRenderer;
    private textureDebugRenderer?: TextureDebugRenderer;

    private showShadowMap = true;

    constructor(
        canvas: HTMLCanvasElement,
        useDevicePixelRatio: boolean = true
    ) {
        this.controllerGUI = new dat.GUI();
        const folder = this.controllerGUI.addFolder("general");
        folder.add(this, "showShadowMap", this.showShadowMap);
        this.context = canvas.getContext("webgpu");

        const devicePixelRatio = useDevicePixelRatio
            ? window.devicePixelRatio ?? 1
            : 1;
        this.presentationSize = [
            canvas.clientWidth * devicePixelRatio,
            canvas.clientHeight * devicePixelRatio,
        ];

        canvas.width = this.presentationSize[0];
        canvas.height = this.presentationSize[1];

        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        console.log(this.presentationFormat);

        this.renderList = [];
        this.device = undefined;

        this.viewCamera = new FreeControlledCamera(
            canvas,
            Math.PI / 5,
            this.presentationSize[0] / this.presentationSize[1],
            0.5,
            500
        );
    }

    async finishInitialization() {
        const adapter = await navigator.gpu.requestAdapter();
        this.device = await adapter?.requestDevice();

        if (this.device != null) {
            this.context?.configure({
                device: this.device,
                format: this.presentationFormat,
                alphaMode: "opaque",
            });
        }

        if (this.device == null || this.context == null) {
            throw new Error("device or context not correctly initialized");
        }

        this.textureDebugRenderer = new TextureDebugRenderer(
            this.device,
            this.context,
            this.presentationFormat
        );

        this.forwardRenderer = new ForwardRenderer(
            this,
            this.device,
            this.context,
            this.presentationSize,
            this.presentationFormat
        );
        this.forwardRenderer.camera = this.viewCamera;
    }

    get viewCamera() {
        return this.camera;
    }

    set viewCamera(camera: Camera) {
        if (camera == null) {
            throw new Error("invalid camera");
        }

        this.camera?.deactivate();
        this.camera = camera;
        this.camera.activate();

        if (this.forwardRenderer != null) {
            this.forwardRenderer.camera = camera;
        }
    }

    getControllerGUI() {
        return this.controllerGUI;
    }

    getTextureDebugRenderer() {
        return this.textureDebugRenderer;
    }

    setDirectionalLight(directionalLight: IDirectionalLight) {
        if (this.forwardRenderer != null) {
            this.forwardRenderer.directionalLight = directionalLight;
        }
    }

    addRenderable(name: string, geometry: IGeometryData): Renderable {
        if (this.device == null) {
            throw new Error("uninitialized");
        }

        const posBuffer = this.device.createBuffer({
            label: `${name} positions buffer`,
            size: geometry.positions.length * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.VERTEX,
            mappedAtCreation: true,
        });
        new Float32Array(posBuffer.getMappedRange()).set(geometry.positions);
        posBuffer.unmap();

        const normalsBuffer = this.device.createBuffer({
            label: `${name} normals buffer`,
            size: geometry.normals.length * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.VERTEX,
            mappedAtCreation: true,
        });
        new Float32Array(normalsBuffer.getMappedRange()).set(geometry.normals);
        normalsBuffer.unmap();

        const indexBuffer = this.device.createBuffer({
            label: `${name} index buffer`,
            size: geometry.indices.length * Uint32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.INDEX,
            mappedAtCreation: true,
        });
        new Uint32Array(indexBuffer.getMappedRange()).set(geometry.indices);
        indexBuffer.unmap();

        const renderable = new Renderable(
            posBuffer,
            normalsBuffer,
            indexBuffer,
            geometry.indices.length
        );

        this.renderList.push(renderable);
        this.forwardRenderer?.addRenderable(renderable);
        return renderable;
    }

    render() {
        if (this.device != null) {
            const commandEncoder = this.device.createCommandEncoder();

            this.forwardRenderer?.render(this.renderList, commandEncoder);
            if (this.showShadowMap === true) {
                this.textureDebugRenderer?.render(commandEncoder);
            }

            this.device.queue.submit([commandEncoder.finish()]);
        }
    }
}
