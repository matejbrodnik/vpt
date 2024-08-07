import { mat4 } from '../../lib/gl-matrix-module.js';

import { PropertyBag } from '../PropertyBag.js';
import { WebGL } from '../WebGL.js';
import { SingleBuffer } from '../SingleBuffer.js';
import { DoubleBuffer } from '../DoubleBuffer.js';

import { Transform } from '../Transform.js';

const [ SHADERS, MIXINS ] = await Promise.all([
    'shaders.json',
    'mixins.json',
].map(url => fetch(url).then(response => response.json())));

export class AbstractRenderer extends PropertyBag {

constructor(gl, volume, camera, environmentTexture, options = {}) {
    super();

    this._resolution = options.resolution ?? 512;

    this._gl = gl;
    this._volume = volume;
    this._camera = camera;
    this._environmentTexture = environmentTexture;

    this._volumeTransform = options.transform ?? new Transform();

    this._rebuildBuffers();

    this._transferFunction = WebGL.createTexture(gl, {
        width   : 2,
        height  : 1,
        data    : new Uint8Array([255, 0, 0, 0, 255, 0, 0, 255]),

        iformat : gl.SRGB8_ALPHA8,
        format  : gl.RGBA,
        type    : gl.UNSIGNED_BYTE,

        wrapS   : gl.CLAMP_TO_EDGE,
        wrapT   : gl.CLAMP_TO_EDGE,
        min     : gl.LINEAR,
        mag     : gl.LINEAR,
    });

    this._clipQuadProgram = WebGL.buildPrograms(gl, {
        quad: SHADERS.quad
    }, MIXINS).quad;
    this.ready = true;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');

}

destroy(destroyRender = true) {
    const gl = this._gl;
    this._frameBuffer.destroy();
    this._accumulationBuffer.destroy();
    if(destroyRender)
        this._renderBuffer.destroy();
    gl.deleteTexture(this._transferFunction);
    gl.deleteProgram(this._clipQuadProgram.program);
}

render() {
    if(this.count == 0) {
        this.startTime = performance.now().toFixed(3);
    }
    // let gl = this._gl;
    // if(this.ready) {
    //     this.query1 = gl.createQuery();
    //     gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.query1);
    // }

    this._frameBuffer.use();
    this._generateFrame();

    this._accumulationBuffer.use();
    this._integrateFrame();
    this._accumulationBuffer.swap();

    this._renderBuffer.use();
    this._renderFrame();
    // if(this.ready) {
    //     gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    //     this.ready = false;
    // }
    if(this.count == 100) {
        let endTime = performance.now().toFixed(3);
        let elapsedTime = (endTime - this.startTime) / 100;
        //console.log(`${elapsedTime.toFixed(6)}`);
    }
    this.count++;

    // let query = this.query1;
    // if(query) {
    //     let available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
    //     let disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);

    //     if (available && !disjoint) {
    //         // See how much time the rendering of the object took in nanoseconds.
    //         let timeElapsed = gl.getQueryParameter(query, gl.QUERY_RESULT);

    //         // Do something useful with the time.  Note that care should be
    //         // taken to use all significant bits of the result, not just the
    //         // least significant 32 bits.
    //         console.log(`READ Time: ${timeElapsed / 1000000} ms`);
    //     }

    //     if (available || disjoint) {
    //         // Clean up the query object.
    //         gl.deleteQuery(this.query1);
    //         // Don't re-enter this polling loop.
    //         this.query1 = null;
    //     }
    //     this.ready = true;

    // }
    
}

reset() {
    this._accumulationBuffer.use();
    this._resetFrame();
    this._accumulationBuffer.swap();
}

_rebuildBuffers() {
    this.count = 0;
    if (this._frameBuffer) {
        this._frameBuffer.destroy();
    }
    if (this._accumulationBuffer) {
        this._accumulationBuffer.destroy();
    }
    if (this._renderBuffer) {
        this._renderBuffer.destroy();
    }
    const gl = this._gl;
    this._frameBuffer = new SingleBuffer(gl, this._getFrameBufferSpec());
    this._accumulationBuffer = new DoubleBuffer(gl, this._getAccumulationBufferSpec());
    this._renderBuffer = new SingleBuffer(gl, this._getRenderBufferSpec());
}

_rebuildRender() {
    this.count = 0;
    if (this._renderBuffer) {
        this._renderBuffer.destroy();
    }
    const gl = this._gl;
    this._renderBuffer = new SingleBuffer(gl, this._getRenderBufferSpec());
    if(this._context.toneMapper) {
        this._context.toneMapper.setTexture(this.getTexture());
    }
}

setVolume(volume) {
    this._volume = volume;
    this.reset();
}

setTransferFunction(transferFunction) {
    const gl = this._gl;
    gl.bindTexture(gl.TEXTURE_2D, this._transferFunction);
    gl.texImage2D(gl.TEXTURE_2D, 0,
        gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, transferFunction);
}

setResolution(resolution) {
    if (resolution !== this._resolution) {
        this._resolution = resolution;
        this._rebuildBuffers();
        this.reset();
    }
}

setContext(context) {
    this._context = context;
}

getTexture() {
    return this._renderBuffer.getAttachments().color[0];
}

_resetFrame() {
    // IMPLEMENT
}

_generateFrame() {
    // IMPLEMENT
}

_integrateFrame() {
    // IMPLEMENT
}

_renderFrame() {
    // IMPLEMENT
}

_getFrameBufferSpec() {
    // IMPLEMENT
}

_getAccumulationBufferSpec() {
    // IMPLEMENT
}

_getRenderBufferSpec() {
    const gl = this._gl;
    return [{
        width   : this._resolution,
        height  : this._resolution,
        min     : gl.NEAREST,
        mag     : gl.NEAREST,
        wrapS   : gl.CLAMP_TO_EDGE,
        wrapT   : gl.CLAMP_TO_EDGE,
        format  : gl.RGBA,
        iformat : gl.RGBA16F,
        type    : gl.FLOAT,
    }];
}

}
