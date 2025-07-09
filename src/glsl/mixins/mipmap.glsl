// #part /glsl/mixins/mipmap

void mipmap(
        inout uint state,
        in sampler2D MIP,
        out vec2 pos)
{
    int a = 0;
    int b = 0;
    for(int i = 8; i >= 0; i--) {
        float nw = texelFetch(MIP, ivec2(a, b), i).r;
        float sw = texelFetch(MIP, ivec2(a, b + 1), i).r;
        float ne = texelFetch(MIP, ivec2(a + 1, b), i).r;
        float se = texelFetch(MIP, ivec2(a + 1, b + 1), i).r;

        float sum = nw + sw + ne + se;
        // state = state + uint(i);
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
        else if(normRand < sum){
            a = (a + 1) * 2;
            b = (b + 1) * 2;
        }
        else {
            a = 1;
            b = 1;
            break;
        }
    }

    // a = a / 2;
    // b = b / 2;

    // float aa = float(a) / 1024.0;
    // aa = aa * 2.0 - 1.0;
    // float bb = float(b) / 1024.0;
    // bb = bb * 2.0 - 1.0;
    pos = vec2(float(a) / 1024.0 * 2.0 - 1.0, float(b) / 1024.0 * 2.0 - 1.0);

}
