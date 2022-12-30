
fn getVisibility(shadowMapCoords: vec3<f32>, lightDirection: vec3<f32>, surfaceNormal: vec3<f32>) -> f32 {
    let pcfResolution = i32(shadowMappingParams.pcfResolution);

    let bias = max(shadowMappingParams.minBias, shadowMappingParams.maxBias * (1.0 - dot(lightDirection, surfaceNormal)));

    var visibility: f32 = 0.0;
    let offset = 1.0 / vec2<f32>(textureDimensions(shadowMap));
    for (var i = -pcfResolution; i <= pcfResolution; i = i + 1) {
        for (var j = -pcfResolution; j <= pcfResolution; j = j + 1) {
            visibility = visibility + textureSampleCompare(
                shadowMap,
                shadowSampler,
                shadowMapCoords.xy + vec2<f32>(f32(i), f32(j)) * offset, shadowMapCoords.z - bias
            );
        }
    }

    let threshold = vec3<f32>(0.2);
    var edgeAdditionalVisibility = clamp((shadowMapCoords.xyz - (1.0 - threshold)) / threshold, vec3<f32>(0.0), vec3<f32>(1.0));
    edgeAdditionalVisibility = max(edgeAdditionalVisibility, 1.0 - clamp(shadowMapCoords.xyz / threshold, vec3<f32>(0.0), vec3<f32>(1.0)));
    visibility = visibility / f32((pcfResolution + pcfResolution + 1) * (pcfResolution + pcfResolution + 1)) + max(max(edgeAdditionalVisibility.x, edgeAdditionalVisibility.y), edgeAdditionalVisibility.z);

    return clamp(visibility, 0.0, 1.0);
}

fn getVisibilityCSM(cascade: i32, shadowMapCoords: vec3<f32>, lightDirection: vec3<f32>, surfaceNormal: vec3<f32>) -> f32 {
    let pcfResolution = 0;
    let bias = max(shadowMappingParams.minBias, shadowMappingParams.maxBias * (1.0 - dot(lightDirection, surfaceNormal)));
    var cascadeShadowMapCoords = shadowMapCoords;

    if (cascade >= 2) {
        cascadeShadowMapCoords.x = cascadeShadowMapCoords.x + 1.0;
    }
    if (cascade % 2 != 0) {
        cascadeShadowMapCoords.y = cascadeShadowMapCoords.y + 1.0;
    }
    cascadeShadowMapCoords.x = cascadeShadowMapCoords.x / 2.0;
    cascadeShadowMapCoords.y = cascadeShadowMapCoords.y / 2.0;


    var visibility: f32 = 0.0;
    let offset = 1.0 / vec2<f32>(textureDimensions(shadowMap));
    for (var i = -pcfResolution; i <= pcfResolution; i = i + 1) {
        for (var j = -pcfResolution; j <= pcfResolution; j = j + 1) {
            visibility = visibility + textureSampleCompare(
                shadowMap,
                shadowSampler,
                cascadeShadowMapCoords.xy + vec2<f32>(f32(i), f32(j)) * offset, cascadeShadowMapCoords.z - bias
            );
        }
    }

    return visibility;
}

fn computeLight(light: LightData, material: Material, cameraPosition: vec3<f32>, position: vec3<f32>, normal: vec3<f32>, visibility: f32, shadowAttenuation: f32) -> vec4<f32> {
    let shadow = mix(shadowAttenuation, 1.0, visibility);
    let N: vec3<f32> = normalize(normal.xyz);
    let L: vec3<f32> = normalize(-light.direction.xyz);
    let V: vec3<f32> = normalize(cameraPosition.xyz - position.xyz);
    let H: vec3<f32> = normalize(L + V);
    let NdotL = max(dot(N, L), 0.0);
    let kD: f32 = shadow * NdotL + light.ambientIntensity;
    var kSEnabled = 0.0;

    let R = reflect(-L, N);
    if (NdotL > 0.0 && dot(V, N) > 0.0) {
        kSEnabled = 1.0;
    }
    let kS: f32 = shadow * kSEnabled * material.specularIntensity * pow(max(dot(H, N), 0.0), material.shininess);
    let finalColor = material.color.rgb * light.color.rgb * kD + light.color.rgb * kS;
    let noise = hash13(position);

    // also add some noise/dither to avoid banding artifacts 
    return vec4<f32>(finalColor, 1.0);//vec4<f32>(finalColor + mix(-0.5/255.0, 0.5/255.0, noise), 1.0);
};

struct ShadowMappingParams {
    minBias: f32,
    maxBias: f32,
    pcfResolution: f32
};

@group(0)
@binding(0)
var<uniform> cameraData: CameraData;

@group(0)
@binding(2) 
var shadowMap: texture_depth_2d;

@group(0) 
@binding(3) 
var shadowSampler: sampler_comparison;

@group(0)
@binding(4)
var<uniform> shadowMappingParams: ShadowMappingParams; 

#if useCSM
@group(0)
@binding(5)
var<uniform> csmLightData: CsmLightData;
#else
@group(0)
@binding(1)
var<uniform> lightData: LightData;
#endif

@group(1)
@binding(0)
var<uniform> renderableData: RenderableData;

const numCascades = ##numCascades=4##;

struct VertexOutput {
    @builtin(position)
    ndc: vec4<f32>,

    @location(0)
    positionWS: vec3<f32>,

    @location(1)
    normalWS: vec3<f32>,

    // shadow map 
    @location(2)
    shadowMapCoords: vec3<f32>,

    //@location(3)
    // TODO is there a way to pass arrays to vertex output / frag input?
    //csmShadowMapCoords: array<vec3<f32>, 4>, // TODO parametric, at the moment pipeline overridable cannot be used
}

@vertex
fn vertexShader(@location(0) position : vec3<f32>,
          @location(1) normal : vec3<f32>) -> VertexOutput {

    var output: VertexOutput;
    let positionWS = renderableData.model * vec4<f32>(position, 1.0);
    output.positionWS = positionWS.xyz;
    output.normalWS = (renderableData.modelNormals * vec4<f32>(normal, 0.0)).xyz;

#if useCSM
    // cascade must be selected in the fragment as a triangle can span multiple cascades
    // (interpolation would not work)
    // -- is there a way to pass array to vertex output / fragment input?
    // for (var i = 0; i < csmCascades; i += 1) {
    //     var shadowProjection = csmLightData.viewProjectionMatrix[i] * positionWS;
    //     shadowProjection = shadowProjection / shadowProjection.w;
    //     output.csmShadowMapCoords[i] = vec3<f32>(shadowProjection.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5), shadowProjection.z);
    // }
#else
    var shadowProjection = lightData.viewProjectionMatrix * positionWS;
    shadowProjection = shadowProjection / shadowProjection.w;
    output.shadowMapCoords = vec3<f32>(shadowProjection.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5), shadowProjection.z);
#endif

    output.ndc = cameraData.viewProjectionMatrix * positionWS;
    return output;
}


@fragment
fn fragmentShader(in: VertexOutput) -> @location(0) vec4<f32> {
    var material: Material;
    material.color = renderableData.color;
    material.shininess = renderableData.shininess;
    material.specularIntensity = renderableData.specularIntensity;
    var visibility: f32 = 1.0;        
#if useCSM 
    var selectedCascade = numCascades;
    var shadowMapCoords = vec3<f32>(-1.0);
    for (var i = 0; i < numCascades; i += 1) {
        // ideally these operations should be performed in the vs
        var csmShadowMapCoords = csmLightData.viewProjectionMatrix[i] * vec4<f32>(in.positionWS, 1.0);
        csmShadowMapCoords = csmShadowMapCoords / csmShadowMapCoords.w;
        shadowMapCoords = vec3<f32>(csmShadowMapCoords.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5), csmShadowMapCoords.z);
        // --

        if (all(shadowMapCoords > vec3<f32>(0.0)) && all(shadowMapCoords < vec3<f32>(1.0))) {
            selectedCascade = i;
            break;
        }
    }

    let debug_cascadeColors = array<vec4<f32>, 5>(
        vec4<f32>(1.0, 0.0, 0.0, 1.0),
        vec4<f32>(0.0, 1.0, 0.0, 1.0),
        vec4<f32>(0.0, 0.0, 1.0, 1.0),
        vec4<f32>(1.0, 1.0, 0.0, 1.0),
        vec4<f32>(0.0, 0.0, 0.0, 1.0)
    );

    var lightData: LightData;
    lightData.ambientIntensity = csmLightData.ambientIntensity;
    lightData.color = csmLightData.color;
    lightData.direction = csmLightData.direction;
    visibility = getVisibilityCSM(selectedCascade, shadowMapCoords, csmLightData.direction.xyz, in.normalWS);
    visibility = select(visibility, 1.0, selectedCascade == numCascades); // no cascade found, set visibility to 1

    let finalColor = computeLight(lightData, material, cameraData.position.xyz,
                        in.positionWS, in.normalWS, visibility, 0.5);
    return mix(finalColor, debug_cascadeColors[selectedCascade], csmLightData.debug_showCascades);
#else
    visibility = getVisibility(in.shadowMapCoords, lightData.direction.xyz, in.normalWS);
    return computeLight(lightData, material, cameraData.position.xyz,
                        in.positionWS, in.normalWS, visibility, 0.5);
#endif
}


// include at end of file to have correct line numbers for previous lines
#include "./shaderCommons.wgsl";
