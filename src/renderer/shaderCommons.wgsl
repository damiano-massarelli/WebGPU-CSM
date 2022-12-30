// Vars

// ~Vars


// Structs

struct CameraData {
    viewProjectionMatrix: mat4x4<f32>, // 0
    position: vec4<f32>,               // 64
                                       // 80
};

struct LightData {
    viewProjectionMatrix: mat4x4<f32>, // 0
    direction: vec4<f32>,              // 64
    color: vec4<f32>,                  // 80
    ambientIntensity: f32,             // 96
                                       // 100
};

struct CsmLightData {
    viewProjectionMatrix: array<mat4x4<f32>, ##numCascades=4##>,
    direction: vec4<f32>,
    color: vec4<f32>,
    ambientIntensity: f32,
    debug_showCascades: f32,
}

struct Material {
    color: vec4<f32>,
    shininess: f32,
    specularIntensity: f32,
}; 

struct RenderableData {
    model: mat4x4<f32>,        // 0
    modelNormals: mat4x4<f32>, // 64
    color: vec4<f32>,          // 128
    shininess: f32,            // 144
    specularIntensity: f32,    // 148
                               // 152
};

// ~Structs

// Functions

// from https://www.shadertoy.com/view/4djSRW
fn hash13(input: vec3<f32>) -> f32 {
	var p3  = fract(input * .1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

// ~Functions