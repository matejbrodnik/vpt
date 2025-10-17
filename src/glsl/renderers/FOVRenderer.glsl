// #part /glsl/shaders/renderers/FOV/integrate/vertex

#version 300 es

const vec2 vertices[] = vec2[](
    vec2(-1, -1),
    vec2( 3, -1),
    vec2(-1,  3)
);

out vec2 vPosition;

void main() {
    vec2 position = vertices[gl_VertexID];
    vPosition = position;
    gl_Position = vec4(position, 0, 1);
}

// #part /glsl/shaders/renderers/FOV/integrate/fragment

#version 300 es
precision highp float;
precision highp sampler2D;
precision highp sampler3D;

#define EPS 1e-5

// #link /glsl/mixins/Photon
@Photon
// #link /glsl/mixins/intersectCube
@intersectCube

@constants
@random/hash/pcg
@random/hash/squashlinear
@random/distribution/uniformdivision
@random/distribution/square
@random/distribution/disk
@random/distribution/sphere
@random/distribution/exponential

@unprojectRand
@mipmap

uniform sampler2D uPosition;
uniform sampler2D uDirection;
uniform sampler2D uTransmittance;
uniform sampler2D uRadiance;
uniform sampler2D uRadianceLast;

uniform sampler3D uVolume;
uniform sampler2D uTransferFunction;
uniform sampler2D uEnvironment;
uniform sampler2D uMIP;

uniform mat4 uMvpInverseMatrix;
uniform vec2 uInverseResolution;
uniform float uRandSeed;
uniform float uBlur;
uniform float uReset;

uniform float uExtinction;
uniform float uAnisotropy;
uniform uint uMaxBounces;
uniform uint uSteps;

in vec2 vPosition;

layout (location = 0) out vec4 oPosition;
layout (location = 1) out vec4 oDirection;
layout (location = 2) out vec4 oTransmittance;
layout (location = 3) out vec4 oRadiance;
layout (location = 4) out vec4 oRadianceLast;
// layout (location = 4) out vec4 oPositionA;

void resetPhoton(inout uint state, inout Photon photon) {
    vec3 from, to;
    unprojectRand(state, photon.positionA, uMvpInverseMatrix, uInverseResolution, uBlur, from, to);
    photon.direction = normalize(to - from);
    photon.bounces = 0u;
    vec2 tbounds = max(intersectCube(from, photon.direction), 0.0);
    photon.position = from + tbounds.x * photon.direction;
    photon.transmittance = vec3(1);
}

void resetPhotonHard(inout uint state, inout Photon photon) {
    vec3 from, to;
    vec2 pos;
    float pdf;
    mipmap(state, uMIP, pos, pdf);
    unprojectRand(state, pos, uMvpInverseMatrix, uInverseResolution, uBlur, from, to);
    // unprojectRand(state, pos, uMvpInverseMatrix, uInverseResolution, uBlur, from, to);

    photon.direction = normalize(to - from);
    vec2 tbounds = max(intersectCube(from, photon.direction), 0.0);
    photon.position = from + tbounds.x * photon.direction;
    photon.transmittance = vec3(1);
    photon.radiance = vec3(0);
    photon.bounces = 0u;
    photon.samples2 = 0.0;
    photon.positionA = pos;
    photon.pdf = pdf;
}

vec4 sampleEnvironmentMap(vec3 d) {
    vec2 texCoord = vec2(atan(d.x, -d.z), asin(-d.y) * 2.0) * INVPI * 0.5 + 0.5;
    return texture(uEnvironment, texCoord);
}

vec4 sampleVolumeColor(vec3 position) {
    vec2 volumeSample = texture(uVolume, position).rg;
    vec4 transferSample = texture(uTransferFunction, volumeSample);
    return transferSample;
}

float sampleHenyeyGreensteinAngleCosine(inout uint state, float g) {
    float g2 = g * g;
    float c = (1.0 - g2) / (1.0 - g + 2.0 * g * random_uniform(state));
    return (1.0 + g2 - c * c) / (2.0 * g);
}

vec3 sampleHenyeyGreenstein(inout uint state, float g, vec3 direction) {
    // generate random direction and adjust it so that the angle is HG-sampled
    vec3 u = random_sphere(state);
    if (abs(g) < EPS) {
        return u;
    }
    float hgcos = sampleHenyeyGreensteinAngleCosine(state, g);
    vec3 circle = normalize(u - dot(u, direction) * direction);
    return sqrt(1.0 - hgcos * hgcos) * circle + hgcos * direction;
}

float max3(vec3 v) {
    return max(max(v.x, v.y), v.z);
}

float mean3(vec3 v) {
    return dot(v, vec3(1.0 / 3.0));
}

void main() {
    Photon photon;
    vec2 mappedPosition = vPosition * 0.5 + 0.5;
    uint state = hash(uvec3(floatBitsToUint(mappedPosition.x), floatBitsToUint(mappedPosition.y), floatBitsToUint(uRandSeed)));

    // && photon.samples >= uint(10)
    if(uReset == 0.0) {
        resetPhotonHard(state, photon);
    }
    else {
        vec4 radianceAndSamples = texture(uRadiance, mappedPosition);
        photon.samples2 = 0.0; //uint(radianceAndSamples.w + 0.5);
        photon.radiance = vec3(0); //radianceAndSamples.rgb;
        // photon.position = texture(uPosition, mappedPosition).xyz;
        photon.position = vec3(texture(uPosition, mappedPosition).xy, texture(uTransmittance, mappedPosition).w);
        vec4 directionAndBounces = texture(uDirection, mappedPosition);
        photon.bounces = uint(directionAndBounces.w + 0.5);
        photon.direction = directionAndBounces.xyz;
        photon.transmittance = texture(uTransmittance, mappedPosition).rgb;
        photon.positionA = texture(uPosition, mappedPosition).zw;
        // photon.positionA = texture(uPositionA, mappedPosition).rg;
        photon.pdf = 1.0;
        //photon.positionA = vPosition;
    }
    
    for (uint i = 0u; i < uSteps; i++) {
        float dist = random_exponential(state, uExtinction);
        photon.position += dist * photon.direction;

        vec4 volumeSample = sampleVolumeColor(photon.position);

        float PNull = 1.0 - volumeSample.a;
        float PScattering;
        if (photon.bounces >= uMaxBounces) {
            PScattering = 0.0;
        } else {
            PScattering = volumeSample.a * max3(volumeSample.rgb);
        }
        float PAbsorption = 1.0 - PNull - PScattering;

        float fortuneWheel = random_uniform(state);
        if (any(greaterThan(photon.position, vec3(1))) || any(lessThan(photon.position, vec3(0)))) {
            // out of bounds
            vec4 envSample = sampleEnvironmentMap(photon.direction);
            vec3 radiance = photon.transmittance * envSample.rgb;
            photon.samples2 += 1.0;
            photon.radiance += radiance;            
            // photon.samples2 += photon.pdf;
            // photon.radiance += (radiance * photon.pdf);
            // photon.radiance += (radiance - photon.radiance) / photon.samples2;
            resetPhoton(state, photon);
        } else if (fortuneWheel < PAbsorption) {
            // absorption
            vec3 radiance = vec3(0);
            photon.samples2 += 1.0;
            // photon.samples2 += photon.pdf;

            // photon.radiance += (radiance - photon.radiance) / photon.samples2;
            resetPhoton(state, photon);
        } else if (fortuneWheel < PAbsorption + PScattering) {
            // scattering
            photon.transmittance *= volumeSample.rgb;
            photon.direction = sampleHenyeyGreenstein(state, uAnisotropy, photon.direction);
            photon.bounces++;
            if(i == uSteps - 1u && uReset == 1.0) {
                i--;
            }
        } else {
            // null collision
            if(i == uSteps - 1u && uReset == 1.0) {
                i--;
            }
        }
    }

    oDirection = vec4(photon.direction, float(photon.bounces));
    oRadiance = vec4(photon.radiance, photon.samples2);
    oPosition = vec4(photon.position.xy, photon.positionA);
    oTransmittance = vec4(photon.transmittance, photon.position.z);
    oRadianceLast = vec4(photon.radiance, photon.samples2);

    // oPositionA = vec4(photon.positionA, 0, 0);
    // oPosition = vec4(photon.position, 0);
    // oTransmittance = vec4(photon.transmittance, 0);
    // oPositionA = vec4(photon.positionA, 0, 0);


    // if (photon.samples2 == 0.0 && photon.positionA == vPosition) {
    //     oRadiance = vec4(0, 1, 0, 1);
    // }
}

// #part /glsl/shaders/renderers/FOV/render/vertex

#version 300 es

out vec2 vPosition;
uniform sampler2D uPosition;

void main() {
    int xCoord = gl_VertexID % 512;
    int yCoord = gl_VertexID / 512;
    vec2 aPosition = texelFetch(uPosition, ivec2(xCoord, yCoord), 0).zw;
    gl_Position = vec4(aPosition, 0, 1);
    vPosition = vec2(float(xCoord) / 512.0, float(yCoord) / 512.0);
    gl_PointSize = 1.0;
}

// #part /glsl/shaders/renderers/FOV/render/fragment

#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uColor;
uniform sampler2D uColor2;

in vec2 vPosition;

layout (location = 0) out vec4 oColor;
layout (location = 1) out vec4 oColor2;

void main() {
    vec2 mappedPosition = vPosition * 0.5 + 0.5;
    vec4 colorAndSamples = texture(uColor, vPosition);
    vec4 colorAndSamples2 = texture(uColor2, vPosition);
    oColor = vec4(colorAndSamples.rgb, colorAndSamples.a);
    oColor2 = vec4(colorAndSamples2.rgb, colorAndSamples2.a);
}

// #part /glsl/shaders/renderers/FOV/reset/vertex

#version 300 es

const vec2 vertices[] = vec2[](
    vec2(-1, -1),
    vec2( 3, -1),
    vec2(-1,  3)
);

out vec2 vPosition;

void main() {
    vec2 position = vertices[gl_VertexID];
    vPosition = position;
    gl_Position = vec4(position, 0, 1);
}

// #part /glsl/shaders/renderers/FOV/reset/fragment

#version 300 es
precision highp float;

// #link /glsl/mixins/Photon
@Photon
// #link /glsl/mixins/intersectCube
@intersectCube

@constants
@random/hash/pcg
@random/hash/squashlinear
@random/distribution/uniformdivision
@random/distribution/square
@random/distribution/disk
@random/distribution/sphere
@random/distribution/exponential

@unprojectRand
@mipmap

uniform mat4 uMvpInverseMatrix;
uniform vec2 uInverseResolution;
uniform float uRandSeed;
uniform float uBlur;
// uniform sampler2D uMIP;

in vec2 vPosition;

layout (location = 0) out vec4 oPosition;
layout (location = 1) out vec4 oDirection;
layout (location = 2) out vec4 oTransmittance;
layout (location = 3) out vec4 oRadiance;

void main() {
    Photon photon;
    vec3 from, to;
    // vec2 pos;
    vec2 pos = vPosition;
    uint state = hash(uvec3(floatBitsToUint(vPosition.x), floatBitsToUint(vPosition.y), floatBitsToUint(uRandSeed)));
    // mipmap(state, uMIP, pos);
    // photon.positionA = pos;
    unprojectRand(state, pos, uMvpInverseMatrix, uInverseResolution, uBlur, from, to);
    photon.positionA = pos;
    
    photon.direction = normalize(to - from);
    vec2 tbounds = max(intersectCube(from, photon.direction), 0.0);
    photon.position = from + tbounds.x * photon.direction;
    photon.transmittance = vec3(1);
    photon.radiance = vec3(0);
    photon.bounces = 0u;
    photon.samples2 = 0.0;
    oDirection = vec4(photon.direction, float(photon.bounces));
    oRadiance = vec4(photon.radiance, photon.samples2);
    oPosition = vec4(photon.position.xy, photon.positionA);
    oTransmittance = vec4(photon.transmittance, photon.position.z);
    // oPosition = vec4(photon.position, 0);
    // oTransmittance = vec4(photon.transmittance, 0);
    // oPositionA = vec4(photon.positionA, 0, 0);
}
