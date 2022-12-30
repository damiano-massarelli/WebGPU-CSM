import { cone, cube, plane, sphere, torus } from "./3d-primitives";
import { mat4, quat, vec3, vec4 } from "gl-matrix";
import { Renderable, Renderer } from "./renderer";

function assignRandomMaterial(renderable: Renderable) {
    renderable.color = vec3.fromValues(
        Math.random(),
        Math.random(),
        Math.random()
    );
    renderable.shininess = Math.random() * 10 + 22;
    renderable.specularIntensity = Math.random() * 0.7;
}

export async function setupScene() {
    if (!("gpu" in navigator)) {
        return;
    }

    const canvas = document.getElementById("canvas-wegbpu");
    if (canvas === null) {
        throw new Error("no canvas");
    }

    const renderer = new Renderer(canvas as HTMLCanvasElement, true);
    await renderer.finishInitialization();

    const groundGeometry = plane();
    const ground = renderer.addRenderable("plane", groundGeometry);
    ground.color = vec3.fromValues(0, 0.6, 0.148);
    ground.specularIntensity = 0.2;
    quat.fromEuler(ground.rotation, -90, 0, 0);
    ground.position[1] = -15;
    ground.scale = vec3.fromValues(10000, 10000, 10000);

    const NUM_ELEMENTS = 300;
    let location = -50;
    const cubeData = cube();
    const torusData = torus(3, 1, 20, 20);

    for (let i = 0; i < NUM_ELEMENTS; ++i) {
        const sx = renderer.addRenderable("sx", cubeData);
        assignRandomMaterial(sx);
        const dx = renderer.addRenderable("dx", cubeData);
        assignRandomMaterial(dx);

        sx.position[0] = -20;
        dx.scale[1] = sx.scale[1] = 20;
        dx.position[0] = 20;
        dx.position[2] = sx.position[2] = location;

        const t = renderer.addRenderable("torus", torusData);
        t.position[2] = location;
        quat.fromEuler(
            t.rotation,
            Math.random() * 360,
            Math.random() * 360,
            Math.random() * 360
        );
        t.position[0] = (Math.random() - 0.5) * 2 * 10;
        assignRandomMaterial(t);

        location -= 15;
    }

    const direction = vec3.fromValues(0.5, -0.2, -1);
    vec3.normalize(direction, direction);
    renderer.setDirectionalLight({
        ambientIntensity: 0.05,
        color: vec3.fromValues(1, 1, 1),
        direction,
    });

    function frame() {
        renderer.render();

        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
}
