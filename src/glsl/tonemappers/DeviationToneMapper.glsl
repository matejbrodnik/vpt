// #part /glsl/shaders/tonemappers/DeviationToneMapper/vertex

#version 300 es

const vec2 vertices[] = vec2[](
    vec2(-1, -1),
    vec2( 3, -1),
    vec2(-1,  3)
);

out vec2 vPosition;

void main() {
    vec2 position = vertices[gl_VertexID];
    vPosition = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0, 1);
}

// #part /glsl/shaders/tonemappers/DeviationToneMapper/fragment

#version 300 es
precision highp float;

#define M_PI 3.1415926535897932384626

uniform highp sampler2D uTexture;
uniform highp sampler2D uTexture2;
uniform highp sampler2D uEnvironment;
uniform float uLow;
uniform float uMid;
uniform float uHigh;
uniform float uSaturation;
uniform float uGamma;

in vec2 vPosition;

out vec4 oColor;

void main() {
    vec4 color = texture(uTexture, vPosition);
    vec4 color2 = texture(uTexture2, vPosition);
    if(color.rgb == vec3(0)) {
        color = vec4(1);
    }
    color = vec4(color.rgb / color.a, 1.0);
    color2 = vec4(color2.rgb / color2.a, 1.0);
    float mse = ((color2.r - color.r) * (color2.r - color.r) + (color2.g - color.g) * (color2.g - color.g) + (color2.b - color.b) * (color2.b - color.b)) / 3.0;

    vec3 deviation = abs(color.rgb / color.a - color2.rgb / color2.a) * 1.5;

    color = vec4(mse, mse, mse, 1.0) * 5.0; 

    color = (color - uLow) / (uHigh - uLow);
    const vec3 gray = normalize(vec3(1));
    color = vec4(mix(dot(color.rgb, gray) * gray, color.rgb, uSaturation), 1.0);
    float midpoint = (uMid - uLow) / (uHigh - uLow);
    float exponent = -log(midpoint) / log(2.0);
    color = pow(color, vec4(exponent / uGamma));

    oColor = vec4(color.rgb, 1.0);
}
