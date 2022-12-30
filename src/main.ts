import { setupScene } from "./renderer/scene";

if (navigator.gpu) {
    setupScene();
} else {
    document.getElementById("webgpu-available")!.innerText =
        "Looks like webgpu is not available :(";
}
