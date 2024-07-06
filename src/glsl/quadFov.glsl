// #part /glsl/shaders/quadFov/vertex

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

// #part /glsl/shaders/quadFov/fragment

#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTexture;
uniform sampler2D uEnvironment;

in vec2 vPosition;

out vec4 oColor;

void main() {
    float one = 1.0 / 512.0;
    vec4 color = texture(uTexture, vPosition);
    //&& vPosition.x > 0.0 && vPosition.x < 1.0 - one && vPosition.y > 0.0 && vPosition.y < 1.0 - one
    if(color.r == 0.0) {
        vec4 e = textureOffset(uTexture, vPosition, ivec2(-1,0));
        if(e.r == 0.0) { // early break
            oColor = texture(uEnvironment, vPosition);
        }
        else {
            vec4 w = textureOffset(uTexture, vPosition, ivec2(1,0));
            vec4 n = textureOffset(uTexture, vPosition, ivec2(0,1));
            vec4 s = textureOffset(uTexture, vPosition, ivec2(0,-1));
            if (w.r == 0.0 || n.r == 0.0 || s.r == 0.0) {
                e = textureOffset(uTexture, vPosition, ivec2(1,1));
                w = textureOffset(uTexture, vPosition, ivec2(-1,1));
                n = textureOffset(uTexture, vPosition, ivec2(1,-1));
                s = textureOffset(uTexture, vPosition, ivec2(-1,-1));
                if (e.r == 0.0 || w.r == 0.0 || n.r == 0.0 || s.r == 0.0) {
                    oColor = texture(uEnvironment, vPosition);
                }
                else {
                    vec4 avg = w + e + n + s;
                    avg /= 4.0;
                    oColor = avg;
                }
            }
            else {
                vec4 avg = w + e + n + s;
                avg /= 4.0;
                oColor = avg;
            }
            //oColor = texture(uEnvironment, vPosition);
        }

    }
    else {
        oColor = texture(uTexture, vPosition);
    }
}
