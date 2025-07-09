import { mat4 } from '../../lib/gl-matrix-module.js';

import { WebGL } from '../WebGL.js';
import { AbstractRenderer } from './AbstractRenderer.js';

import { PerspectiveCamera } from '../PerspectiveCamera.js';
import { MIPRenderer } from './MIPRenderer.js';
import { MCMRenderer } from './MCMRenderer.js';

const [ SHADERS, MIXINS ] = await Promise.all([
    'shaders.json',
    'mixins.json',
].map(url => fetch(url).then(response => response.json())));

export class FOVRenderer extends AbstractRenderer {

constructor(gl, volume, camera, environmentTexture, options = {}) {
    super(gl, volume, camera, environmentTexture, options);

    this.registerProperties([
        {
            name: 'extinction',
            label: 'Extinction',
            type: 'spinner',
            value: 50,
            min: 0,
        },
        {
            name: 'anisotropy',
            label: 'Anisotropy',
            type: 'slider',
            value: 0,
            min: -1,
            max: 1,
        },
        {
            name: 'bounces',
            label: 'Max bounces',
            type: 'spinner',
            value: 8,
            min: 0,
        },
        {
            name: 'steps',
            label: 'Steps',
            type: 'spinner',
            value: 40,
            min: 0,
        },
        {
            name: 'transferFunction',
            label: 'Transfer function',
            type: 'transfer-function',
            value: new Uint8Array(256),
        },
    ]);

    this.addEventListener('change', e => {
        const { name, value } = e.detail;
        console.log("TRANSFER FUNCTION");
        if (name === 'transferFunction') {
            this.setTransferFunction(this.transferFunction);
        }

        if ([
            'extinction',
            'anisotropy',
            'bounces',
            'transferFunction',
        ].includes(name)) {
            this.reset();
        }
    });

    this._programs = WebGL.buildPrograms(gl, SHADERS.renderers.FOV, MIXINS);
    this._programs2 = WebGL.buildPrograms(gl, SHADERS.renderers.MCM, MIXINS);
    this.resetCount = 0;
    this.ready = true;
    this.generate = true;
}

destroy() {
    const gl = this._gl;
    Object.keys(this._programs).forEach(programName => {
        gl.deleteProgram(this._programs[programName].program);
    });

    super.destroy();
}

_resetFrame() {
    const gl = this._gl;

    if(this.mip == null) {
        this.mip = new MIPRenderer(gl, this._volume, this._camera, this._environmentTexture, {
            resolution: this._resolution,
            transform: this._volumeTransform
        });
        this.mip.setContext(this._context);
    }
    // time measure
    let measure = false;
    let ext = this._context.ext;
    if(this.ready && measure) {
        this.query1 = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, this.query1);
    }

    this.mip.reset();

    this.mip.render();

    this._MIPmap = { ...this.mip._renderBuffer.getAttachments() }; // MOGOČE TUKAJ??? KAJ JE BILO TREBA, DA SE TEKSTURA OHRANI/NE POVOZI NA UNDEFINED??

    this._accumulationBuffer.use();

    this._context.count2 = 0;
    this._context.FOVList = [];

    // if(this.mcm == null) {
    //     this.mcm = new MCMRenderer(gl, this._volume, this._camera, this._environmentTexture, {
    //         resolution: this._resolution,
    //         transform: this._volumeTransform
    //     });
    //     this.mcm.setContext(this._context);
    // }

    const { program, uniforms } = this._programs.reset;
    gl.useProgram(program);

    gl.uniform2f(uniforms.uInverseResolution, 1 / this._resolution, 1 / this._resolution);
    gl.uniform1f(uniforms.uRandSeed, Math.random());
    gl.uniform1f(uniforms.uBlur, 0);

    // gl.activeTexture(gl.TEXTURE0);
    // gl.bindTexture(gl.TEXTURE_2D, this._MIPmap.color[0]);
    // gl.uniform1i(uniforms.uMIP, 0);
    
    // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
    // //gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // gl.generateMipmap(gl.TEXTURE_2D);
    
    if(this.ready && measure) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
    }
    const centerMatrix = mat4.fromTranslation(mat4.create(), [-0.5, -0.5, -0.5]);
    const modelMatrix = this._volumeTransform.globalMatrix;
    const viewMatrix = this._camera.transform.inverseGlobalMatrix;
    const projectionMatrix = this._camera.getComponent(PerspectiveCamera).projectionMatrix;

    const matrix = mat4.create();
    mat4.multiply(matrix, centerMatrix, matrix);
    mat4.multiply(matrix, modelMatrix, matrix);
    mat4.multiply(matrix, viewMatrix, matrix);
    mat4.multiply(matrix, projectionMatrix, matrix);
    mat4.invert(matrix, matrix);
    gl.uniformMatrix4fv(uniforms.uMvpInverseMatrix, false, matrix);

    gl.drawBuffers([
        gl.COLOR_ATTACHMENT0,
        gl.COLOR_ATTACHMENT1,
        gl.COLOR_ATTACHMENT2,
        gl.COLOR_ATTACHMENT3,
        gl.COLOR_ATTACHMENT4,
    ]);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    let error = gl.getError();
    if(error != 0)
        console.log("ERROR", error);

    //this.mip.destroy();

    this._rebuildRender();

    if(this.query1 && measure) {
        let available = gl.getQueryParameter(this.query1, gl.QUERY_RESULT_AVAILABLE);
        let disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);

        if (available && !disjoint) {
            let timeStart = gl.getQueryParameter(this.query1, gl.QUERY_RESULT);
            console.log(`READ Time: ${(timeStart) / 1000000.0} ms`);

        }
        else {
            this.ready = false;
        }

        if (available || disjoint) {
            gl.deleteQuery(this.query1);
            this.query1 = null;
            this.ready = true;
        }
        //this.ready = true;

    }

}

_generateFrame() {
}

_integrateFrame() {
    const gl = this._gl;

    const { program, uniforms } = this._programs.integrate;
    gl.useProgram(program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._accumulationBuffer.getAttachments().color[0]);
    gl.uniform1i(uniforms.uPosition, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._accumulationBuffer.getAttachments().color[1]);
    gl.uniform1i(uniforms.uDirection, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this._accumulationBuffer.getAttachments().color[2]);
    gl.uniform1i(uniforms.uTransmittance, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this._accumulationBuffer.getAttachments().color[3]);
    gl.uniform1i(uniforms.uRadiance, 3);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_3D, this._volume.getTexture());
    gl.uniform1i(uniforms.uVolume, 4);

    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this._environmentTexture);
    gl.uniform1i(uniforms.uEnvironment, 5);

    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this._transferFunction);
    gl.uniform1i(uniforms.uTransferFunction, 6);

    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, this._accumulationBuffer.getAttachments().color[4]);
    gl.uniform1i(uniforms.uPositionA, 7);

    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, this._MIPmap.color[0]);
    gl.uniform1i(uniforms.uMIP, 8);
    
    // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);

    //gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if(this.generate) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
        gl.generateMipmap(gl.TEXTURE_2D);
        this.generate = false;
    }

    gl.uniform2f(uniforms.uInverseResolution, 1 / this._resolution, 1 / this._resolution);
    gl.uniform1f(uniforms.uRandSeed, Math.random());
    gl.uniform1f(uniforms.uBlur, 0);

    if(this.resetCount > 1) {
        gl.uniform1f(uniforms.uReset, 1.0);
        this.resetCount = 0;
    }
    else {
        gl.uniform1f(uniforms.uReset, 0.0);
        this.resetCount++;
    }

    gl.uniform1f(uniforms.uExtinction, this.extinction);
    gl.uniform1f(uniforms.uAnisotropy, this.anisotropy);
    gl.uniform1ui(uniforms.uMaxBounces, this.bounces);
    gl.uniform1ui(uniforms.uSteps, this.steps);

    const centerMatrix = mat4.fromTranslation(mat4.create(), [-0.5, -0.5, -0.5]);
    const modelMatrix = this._volumeTransform.globalMatrix;
    const viewMatrix = this._camera.transform.inverseGlobalMatrix;
    const projectionMatrix = this._camera.getComponent(PerspectiveCamera).projectionMatrix;

    const matrix = mat4.create();
    mat4.multiply(matrix, centerMatrix, matrix);
    mat4.multiply(matrix, modelMatrix, matrix);
    mat4.multiply(matrix, viewMatrix, matrix);
    mat4.multiply(matrix, projectionMatrix, matrix);
    mat4.invert(matrix, matrix);
    gl.uniformMatrix4fv(uniforms.uMvpInverseMatrix, false, matrix);

    gl.drawBuffers([
        gl.COLOR_ATTACHMENT0,
        gl.COLOR_ATTACHMENT1,
        gl.COLOR_ATTACHMENT2,
        gl.COLOR_ATTACHMENT3,
        gl.COLOR_ATTACHMENT4,
    ]);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
}

_renderFrame() {
    const gl = this._gl;

    const { program, uniforms } = this._programs.render;
    gl.useProgram(program);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._accumulationBuffer.getAttachments().color[3]);
    gl.uniform1i(uniforms.uColor, 0);
    
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._accumulationBuffer.getAttachments().color[5]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1i(uniforms.uRadianceA, 1);
    
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this._accumulationBuffer.getAttachments().color[4]);
    gl.uniform1i(uniforms.uPositionA, 2);
        
    gl.drawArrays(gl.POINTS, 0, 512*512);
    gl.disable(gl.BLEND);
    if(this.query1) {
        let available = gl.getQueryParameter(this.query1, gl.QUERY_RESULT_AVAILABLE);
        let disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);

        if (available && !disjoint) {
            let timeStart = gl.getQueryParameter(this.query1, gl.QUERY_RESULT);
            console.log(`READ Time: ${(timeStart) / 1000000.0} ms`);

        }
        else {
            this.ready = false;
        }

        if (available || disjoint) {
            gl.deleteQuery(this.query1);
            this.query1 = null;
            this.ready = true;
        }
        //this.ready = true;

    }
    // this._processFrame();
    this.generate = true;
    this.resetCount = 0;
}


_getFrameBufferSpec() {
    const gl = this._gl;
    return [{
        width   : this._resolution,
        height  : this._resolution,
        min     : gl.NEAREST,
        mag     : gl.NEAREST,
        format  : gl.RGBA,
        iformat : gl.RGBA32F,
        type    : gl.FLOAT,
    }];
}

_getAccumulationBufferSpec() {
    const gl = this._gl;

    const positionBufferSpec = {
        width   : this._resolution,
        height  : this._resolution,
        min     : gl.NEAREST,
        mag     : gl.NEAREST,
        format  : gl.RGBA,
        iformat : gl.RGBA32F,
        type    : gl.FLOAT,
    };

    const directionBufferSpec = {
        width   : this._resolution,
        height  : this._resolution,
        min     : gl.NEAREST,
        mag     : gl.NEAREST,
        format  : gl.RGBA,
        iformat : gl.RGBA32F,
        type    : gl.FLOAT,
    };

    const transmittanceBufferSpec = {
        width   : this._resolution,
        height  : this._resolution,
        min     : gl.NEAREST,
        mag     : gl.NEAREST,
        format  : gl.RGBA,
        iformat : gl.RGBA32F,
        type    : gl.FLOAT,
    };

    const radianceBufferSpec = {
        width   : this._resolution,
        height  : this._resolution,
        min     : gl.NEAREST,
        mag     : gl.NEAREST,
        format  : gl.RGBA,
        iformat : gl.RGBA32F,
        type    : gl.FLOAT,
    };

    const positionABufferSpec = {
        width   : this._resolution,
        height  : this._resolution,
        min     : gl.NEAREST,
        mag     : gl.NEAREST,
        format  : gl.RGBA,
        iformat : gl.RGBA32F,
        type    : gl.FLOAT,
    };

    const radianceABufferSpec = {
        width   : this._resolution,
        height  : this._resolution,
        min     : gl.NEAREST,
        mag     : gl.NEAREST,
        format  : gl.RGBA,
        iformat : gl.RGBA32F,
        type    : gl.FLOAT,
    };

    return [
        positionBufferSpec,
        directionBufferSpec,
        transmittanceBufferSpec,
        radianceBufferSpec,
        positionABufferSpec,
        radianceABufferSpec,
    ];
}

}
