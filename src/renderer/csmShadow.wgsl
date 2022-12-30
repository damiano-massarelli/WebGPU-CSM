

@group(0)
@binding(0)
var<uniform> lightData: CsmLightData;

@group(1)
@binding(0)
var<uniform> renderableData: RenderableData;

@vertex
fn vertexShader(@location(0) pos : vec3<f32>, @builtin(instance_index) cascade: u32) -> @builtin(position) vec4<f32> {
    let wsPosition = renderableData.model * vec4<f32>(pos, 1.0);

    return lightData.viewProjectionMatrix[cascade] * wsPosition;
}

// include at end of file to have correct line numbers for previous lines
#include "./shaderCommons.wgsl";
