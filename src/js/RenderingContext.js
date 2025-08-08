import { WebGL } from './WebGL.js';
import { Ticker } from './Ticker.js';

import { Node } from './Node.js';
import { PerspectiveCamera } from './PerspectiveCamera.js';
import { Volume } from './Volume.js';
import { Transform } from './Transform.js';

import { RendererFactory } from './renderers/RendererFactory.js';
import { ToneMapperFactory } from './tonemappers/ToneMapperFactory.js';

import { CircleAnimator } from './animators/CircleAnimator.js';
import { OrbitCameraAnimator } from './animators/OrbitCameraAnimator.js';
import { FOVRenderer } from './renderers/FOVRenderer.js';
import { MIPRenderer } from './renderers/MIPRenderer.js';
import { MCMRenderer } from './renderers/MCMRenderer.js';

const [ SHADERS, MIXINS ] = await Promise.all([
    'shaders.json',
    'mixins.json',
].map(url => fetch(url).then(response => response.json())));

export class RenderingContext extends EventTarget {

constructor(options = {}) {
    super();

    this.render = this.render.bind(this);
    this.webglcontextlostHandler = this.webglcontextlostHandler.bind(this);
    this.webglcontextrestoredHandler = this.webglcontextrestoredHandler.bind(this);

    this.canvas = document.createElement('canvas');
    this.canvas.addEventListener('webglcontextlost', this.webglcontextlostHandler);
    this.canvas.addEventListener('webglcontextrestored', this.webglcontextrestoredHandler);

    this.initGL();

    this.resolution = options.resolution ?? 512;
    this.filter = options.filter ?? 'linear';

    this.camera = new Node();
    this.camera.transform.localTranslation = [0, 0, 2];
    this.camera.components.push(new PerspectiveCamera(this.camera));

    this.camera.transform.addEventListener('change', e => {
        if (this.renderer) {
            this.renderer.reset();
        }
    });

    //this.cameraAnimator = new CircleAnimator(this.camera, {
    //    center: [0, 0, 2],
    //    direction: [0, 0, 1],
    //    radius: 0.01,
    //    frequency: 1,
    //});
    this.cameraAnimator = new OrbitCameraAnimator(this.camera, this.canvas);

    this.volume = new Volume(this.gl);
    this.volumeTransform = new Transform(new Node());
    this.once = false;
    this.count1 = 0;
    this.count2 = 0;
    this.timeoffsetF = 0;
    this.timeoffsetM = 0;
    this.FOVList = [];
    this.MCMList = [];
}

// ============================ WEBGL SUBSYSTEM ============================ //

initGL() {
    const contextSettings = {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: true,
    };

    this.contextRestorable = true;

    this.gl = this.canvas.getContext('webgl2', contextSettings);
    const gl = this.gl;

    this.extLoseContext = gl.getExtension('WEBGL_lose_context');
    this.extColorBufferFloat = gl.getExtension('EXT_color_buffer_float');
    this.extTextureFloatLinear = gl.getExtension('OES_texture_float_linear');
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!this.ext) {
        console.error('EXT_disjoint_timer_query is not supported');
    }

    if (!this.extColorBufferFloat) {
        console.error('EXT_color_buffer_float not supported!');
    }

    if (!this.extTextureFloatLinear) {
        console.error('OES_texture_float_linear not supported!');
    }

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    this.environmentTexture = WebGL.createTexture(gl, {
        width   : 1,
        height  : 1,
        data    : new Uint8Array([255, 255, 255, 255]),
        format  : gl.RGBA,
        iformat : gl.RGBA, // TODO: HDRI & OpenEXR support
        type    : gl.UNSIGNED_BYTE,
        wrapS   : gl.CLAMP_TO_EDGE,
        wrapT   : gl.CLAMP_TO_EDGE,
        min     : gl.LINEAR,
        max     : gl.LINEAR,
    });

    this.measureTexture = WebGL.createTexture(gl, {
        width   : 1,
        height  : 1,
        data    : new Uint8Array([255, 255, 255, 255]),
        format  : gl.RGBA,
        iformat : gl.RGBA, // TODO: HDRI & OpenEXR support
        type    : gl.UNSIGNED_BYTE,
        wrapS   : gl.CLAMP_TO_EDGE,
        wrapT   : gl.CLAMP_TO_EDGE,
        min     : gl.LINEAR,
        max     : gl.LINEAR,
    });

    this.programs = WebGL.buildPrograms(gl, {
        quad: SHADERS.quad,
        quadFov: SHADERS.quadFov
    }, MIXINS);

}

enableBtn() {
    console.log("snap");
    this.countdown = 5;
}

webglcontextlostHandler(e) {
    if (this.contextRestorable) {
        e.preventDefault();
    }
}

webglcontextrestoredHandler(e) {
    this.initGL();
}

resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.camera.getComponent(PerspectiveCamera).aspect = width / height;
}

async setVolume(reader) {
    this.volume = new Volume(this.gl, reader);
    this.volume.addEventListener('progress', e => {
        this.dispatchEvent(new CustomEvent('progress', { detail: e.detail }));
    });
    await this.volume.load();
    this.volume.setFilter(this.filter);
    if (this.renderer) {
        this.renderer.setVolume(this.volume);
    }
}

setEnvironmentMap(image) {
    WebGL.createTexture(this.gl, {
        texture : this.environmentTexture,
        image   : image
    });
}

setFilter(filter) {
    this.filter = filter;
    if (this.volume) {
        this.volume.setFilter(filter);
        if (this.renderer) {
            this.renderer.reset();
        }
    }
}

chooseRenderer(renderer) {
    if (this.renderer) {
        this.renderer.destroy();
    }
    const rendererClass = RendererFactory(renderer);
    this.renderer = new rendererClass(this.gl, this.volume, this.camera, this.environmentTexture, {
        resolution: this.resolution,
        transform: this.volumeTransform,
    });
    this.renderer.setContext(this);
    this.renderer.reset();
    if (this.toneMapper) {
        this.toneMapper.setTexture(this.renderer.getTexture());
    }
    this.isTransformationDirty = true;
    this.count1 = 0;
    this.count2 = 0;
    this.timer2 = 0;
    this.count = 0;
    this.pendingQueries = [];
    this.queryTime = 0;
    this.query = null;
}

chooseToneMapper(toneMapper) {
    if (this.toneMapper && !this.keep) {
        this.toneMapper.destroy();
    }
    const gl = this.gl;
    let texture;
    if (this.renderer) {
        texture = this.renderer.getTexture();
    } else {
        texture = WebGL.createTexture(gl, {
            width  : 1,
            height : 1,
            data   : new Uint8Array([255, 255, 255, 255]),
        });
    }
    const toneMapperClass = ToneMapperFactory(toneMapper);
    this.toneMapper = new toneMapperClass(gl, texture, {
        resolution: this.resolution,
    });
}

render() {
    const gl = this.gl;
    if (!gl || !this.renderer || !this.toneMapper) {
        return;
    }
    let ext = this.ext;
    if(this.queryTime == 0) {
        this.query = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, this.query);
    }

    this.renderer.render();
    this.toneMapper.render();
    
    // if(this.renderer instanceof FOVRenderer)
    //     this.program = this.programs.quadFov;
    // else 
        this.program = this.programs.quad;
    
    const { program, uniforms } = this.program;
    
    gl.useProgram(program);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.toneMapper.getTexture());
    gl.uniform1i(uniforms.uTexture, 0);

    if(this.renderer instanceof FOVRenderer) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.environmentTexture);
        gl.uniform1i(uniforms.uEnvironment, 2);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if(this.queryTime == 0) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
    }

    // this.pendingQueries.push(query);
    // const readyQueries = [];
    // for (let q of this.pendingQueries) {
    if(this.queryTime == 2) {
        // console.log(this.query);

        const available = gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE);
        const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);

        if (available) {
            if (!disjoint) {
                const elapsedTime = gl.getQueryParameter(this.query, gl.QUERY_RESULT);
                this.timer2 += elapsedTime;
                this.count++;
            }
            else
                console.log("DISJOINT");
            // console.log("PASSED");

            gl.deleteQuery(this.query);
            this.query = null;
            // readyQueries.push(q);
        }
        else
            console.log("NOT READY");
        this.queryTime = -1;
    }

    this.queryTime++;
    // this.pendingQueries = this.pendingQueries.filter(q => !readyQueries.includes(q));

    if((this.renderer instanceof MCMRenderer)) {
        if(this.count1 == 0) {
            this.timerM = performance.now().toFixed(3);
        }
        //if(this.count1 < 100 && this.count1 % 5 == 0 || this.count1 == 300) {
        if(this.count1 == 5000) {
            this.pixels = new Uint8Array(512 * 512 * 4);
            gl.readPixels(0, 0, 512, 512, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
            //this.renderer.measureTexture = { ...this.toneMapper.getTexture() };
            console.log("-\n-\n-\nMEASURE READY\n-\n-\n-");
            this.first = true;
        }
        if(this.first && this.count1 % 25 == 0 && this.count1 < 501) {
            let pixels4 = new Uint8Array(512 * 512 * 4);
            this.timer3 = performance.now().toFixed(3);
            gl.readPixels(0, 0, 512, 512, gl.RGBA, gl.UNSIGNED_BYTE, pixels4);
            this.MCMList.push(pixels4);
            this.timeoffsetM += performance.now().toFixed(3) - this.timer3;

            if(this.count1 == 500) {
                console.log("MCM READY");
                this.second = true;
            }
        }
        if(this.count1 == 500 && this.second) {
            console.log("FOV TIME");
            console.log(this.FOVtime);
            console.log("MCM TIME");
            console.log(performance.now().toFixed(3) - this.timerM - this.timeoffsetM);
            let listF = [];
            let listM = [];
            for(let k = 0; k < this.FOVList.length; k++) { //FOVList length = MCMList length - 1?
                let mseF = 0;
                let mseM = 0;
                for(let i = 0; i < 512; i++) {
                    for(let j = 0; j < 512; j++) {
                        let index = (i * 512 + j) * 4;
                        let R = this.pixels[index];
                        let G = this.pixels[index+1];
                        let B = this.pixels[index+2];
    
                        let r = this.FOVList[k][index];
                        let g = this.FOVList[k][index+1];
                        let b = this.FOVList[k][index+2];
    
                        let rr = this.MCMList[k][index];
                        let gg = this.MCMList[k][index+1];
                        let bb = this.MCMList[k][index+2];
    
                        mseF += ((R - r) * (R - r) + (G - g) * (G - g) + (B - b) * (B - b)) / 3.0;
                        mseM += ((R - rr) * (R - rr) + (G - gg) * (G - gg) + (B - bb) * (B - bb)) / 3.0;
                        //console.log(mse);
                    }
                }
                console.log("MEASURE " + k * 25);
                console.log(mseF / (512*512));
                console.log(mseM / (512*512));
                // listF.push(mseF / (512*512));
                // listM.push(mseM / (512*512));
            }
            // console.log(listF);
            // console.log(listM);

            let white = 0;
            let it = 0;
            for(let i = 0; i < 512; i++) {
                for(let j = 0; j < 512; j++) {
                    let index = (i * 512 + j) * 4;
                    let R = this.pixels[index];
                    let G = this.pixels[index+1];
                    let B = this.pixels[index+2];
                    if(R + G + B == 765)
                        white++;
                    it++;
                }
            }
            console.log("WHITE %: " + white / it);
        }

        this.count1++;
    }
    else if((this.renderer instanceof FOVRenderer)) {
        if(this.count2 == 0) {
            this.timerF = performance.now().toFixed(3);

            //gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.query1);
        }
        if(this.count2 % 25 == 0 && this.count2 < 501) {
            //this.query1 = gl.createQuery();
            this.timer4 = performance.now().toFixed(3);

            let pixels3 = new Uint8Array(512 * 512 * 4);
            gl.readPixels(0, 0, 512, 512, gl.RGBA, gl.UNSIGNED_BYTE, pixels3);
            this.FOVList.push(pixels3);
            this.timeoffsetF += performance.now().toFixed(3) - this.timer4;

            if(this.count2 == 500) {
                console.log("FOV READY");
                this.FOVtime = performance.now().toFixed(3) - this.timerF - this.timeoffsetF;
            }
            //gl.endQuery(this.ext.TIME_ELAPSED_EXT);
            //console.log(this.FOVList);
        }
        
        

        this.count2++;
    }

    if(this.count % 50 == 0 && this.timer2 != 0) {
        console.log(`READ Time: ${(this.timer2 / 50.0) / 1000000.0} ms`);
        this.timer2 = 0;
    }
}

            // let imageURL  = this.canvas.toDataURL('image/png');
            // var downloadLink = document.createElement('a');
            // downloadLink.href = imageURL;
            // if(this.renderer instanceof FOVRenderer) {
            //     downloadLink.download = 'FOV.png';
            // }
            // else {
            //     downloadLink.download = 'MCM.png';
            // }
            // document.body.appendChild(downloadLink);
            // downloadLink.click();
            // document.body.removeChild(downloadLink);

get resolution() {
    return this._resolution;
}

set resolution(resolution) {
    this._resolution = resolution;
    this.canvas.width = resolution;
    this.canvas.height = resolution;
    if (this.renderer) {
        this.renderer.setResolution(resolution);
    }
    if (this.toneMapper) {
        this.toneMapper.setResolution(resolution);
        if (this.renderer) {
            this.toneMapper.setTexture(this.renderer.getTexture());
        }
    }
}

async recordAnimation(options = {}) {
    const date = new Date();
    const timestamp = [
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
    ].join('_');

    if (options.type === 'images') {
        const parentDirectory = await showDirectoryPicker();
        const directory = await parentDirectory.getDirectoryHandle(timestamp, { create: true });
        this.recordAnimationToImageSequence({ directory, ...options });
    } else if (options.type === 'video') {
        const outputStream = await showSaveFilePicker({
            suggestedName: timestamp + '.mp4',
        }).then(file => file.createWritable());
        this.recordAnimationToVideo({ outputStream, ...options });
    } else {
        throw new Error(`animation output type (${options.type}) not supported`);
    }
}

async recordAnimationToImageSequence(options = {}) {
    const { directory, startTime, endTime, frameTime, fps } = options;
    const frames = Math.max(Math.ceil((endTime - startTime) * fps), 1);
    const timeStep = 1 / fps;

    function wait(millis) {
        return new Promise((resolve, reject) => setTimeout(resolve, millis));
    }

    function pad(number, length) {
        const string = String(number);
        const remaining = length - string.length;
        const padding = new Array(remaining).fill('0').join('');
        return padding + string;
    }

    const canvas = this.canvas;
    function getCanvasBlob() {
        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => resolve(blob));
        });
    }

    this.stopRendering();

    for (let i = 0; i < frames; i++) {
        const t = startTime + i * timeStep;
        this.cameraAnimator.update(t);

        this.renderer.reset();
        this.startRendering();
        await wait(frameTime * 1000);
        this.stopRendering();

        const filename = `frame${pad(i, 4)}.png`;
        const file = await directory.getFileHandle(filename, { create: true })
            .then(file => file.createWritable());
        const blob = await getCanvasBlob();
        file.write(blob);
        file.close();

        this.dispatchEvent(new CustomEvent('animationprogress', {
            detail: (i + 1) / frames
        }));
    }

    this.startRendering();
}

async recordAnimationToVideo(options = {}) {
    const { outputStream, startTime, endTime, frameTime, fps } = options;
    const frames = Math.max(Math.ceil((endTime - startTime) * fps), 1);
    const timeStep = 1 / fps;

    function wait(millis) {
        return new Promise((resolve, reject) => setTimeout(resolve, millis));
    }

    function pad(number, length) {
        const string = String(number);
        const remaining = length - string.length;
        const padding = new Array(remaining).fill('0').join('');
        return padding + string;
    }

    const canvasStream = this.canvas.captureStream(0);
    const videoStream = canvasStream.getVideoTracks()[0];
    const recorder = new MediaRecorder(canvasStream, {
        videoBitsPerSecond : 4 * 1024 * 1024,
    });
    recorder.addEventListener('dataavailable', e => {
        outputStream.write(e.data);
        outputStream.close();
    });

    this.stopRendering();
    recorder.start();

    for (let i = 0; i < frames; i++) {
        const t = startTime + i * timeStep;
        this.cameraAnimator.update(t);

        this.renderer.reset();
        this.startRendering();
        await wait(frameTime * 1000);
        this.stopRendering();

        videoStream.requestFrame();

        this.dispatchEvent(new CustomEvent('animationprogress', {
            detail: (i + 1) / frames
        }));
    }

    recorder.stop();
    this.startRendering();
}

startRendering() {
    Ticker.add(this.render);
}

stopRendering() {
    Ticker.remove(this.render);
}

}
