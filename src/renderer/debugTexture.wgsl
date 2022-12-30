@group(0)
@binding(0) 
var tex: texture_depth_2d;

@group(0) 
@binding(1) 
var textureSampler: sampler;

struct VertexOutput {
    @builtin(position)
    ndc: vec4<f32>,

    @location(0)
    uv: vec2<f32>,
}

@vertex
fn vertexShader(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 8>(
            vec2<f32>(-0.1, 0.9), vec2<f32>(1.0, 0.0),
            vec2<f32>(-0.1, 0.1), vec2<f32>(1.0, 1.0),
            vec2<f32>(-0.9, 0.9), vec2<f32>(0.0, 0.0),
            vec2<f32>(-0.9, 0.1), vec2<f32>(0.0, 1.0),
    );
    
    var vo: VertexOutput;
    vo.ndc = vec4<f32>(positions[vertexIndex * 2], 0.0, 1.0);
    vo.uv = positions[vertexIndex * 2 + 1];
    return vo;
}

@fragment
fn fragmentShader(in: VertexOutput) -> @location(0) vec4<f32> {
    let t = textureSample(tex, textureSampler, in.uv);
    return vec4<f32>(t, t, t, 1.0);
}

// include at end of file to have correct line numbers for previous lines
#include "./shaderCommons.wgsl";
