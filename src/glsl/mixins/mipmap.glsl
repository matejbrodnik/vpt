// #part /glsl/mixins/mipmap

void mipmap(
        inout uint state,
        in vec2 position,
        in mat4 inverseMvp,
        in vec2 inverseResolution,
        in float blur,
        in sampler2D MIP,
        out vec2 pos,
        out vec3 from, out vec3 to)
{
    vec2 mappedPosition = position * 0.5 + 0.5;
    int a = 0;
    int b = 0;
    for(int i = 8; i >= 0; i--) {
        float nw = texelFetch(MIP, ivec2(a, b), i).r;
        float sw = texelFetch(MIP, ivec2(a, b + 1), i).r;
        float ne = texelFetch(MIP, ivec2(a + 1, b), i).r;
        float se = texelFetch(MIP, ivec2(a + 1, b + 1), i).r;
        // if(i < 4) {
        //     nw = nw * nw;
        //     sw = sw * sw;
        //     ne = ne * ne;
        //     se = se * se;
        // }

        float sum = nw + sw + ne + se;
        state = state + uint(i);
        float normRand = random_uniform(state);
        normRand *= sum;
        if(normRand < nw) {
            a *= 2;
            b *= 2;
        }
        else if(normRand < sw + nw) {
            a *= 2;
            b = (b + 1) * 2;
        }
        else if(normRand < ne + sw + nw) {
            a = (a + 1) * 2;
            b *= 2;
        }
        else if(normRand < sum) {
            a = (a + 1) * 2;
            b = (b + 1) * 2;
        }
    }

    a = a / 2;
    b = b / 2;

    float aa = float(a) / 511.0;
    aa = aa * 2.0 - 1.0;
    float bb = float(b) / 511.0;
    bb = bb * 2.0 - 1.0;
    pos = vec2(aa, bb);

    unprojectRand(state, pos, inverseMvp, inverseResolution, blur, from, to);

}
