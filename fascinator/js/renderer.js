// Bull Fascinator — WebGL renderer with noise, feedback, throb, and color palettes

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Simple pass-through for blit to screen
const FRAG_BLIT = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
void main() {
    gl_FragColor = texture2D(u_tex, v_uv);
}`;

// Main fragment shader: generates the visual field
const FRAG_MAIN = `
precision highp float;
varying vec2 v_uv;
uniform float u_time;
uniform float u_throb;
uniform vec2 u_resolution;
uniform float u_feedback;
uniform vec3 u_palette[4];
uniform sampler2D u_prev;
uniform sampler2D u_text;
uniform float u_bathDepth;

// simplex-ish noise
vec3 mod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289((x * 34.0 + 1.0) * x); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

float fbm(vec2 p, float t) {
    float f = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
        f += amp * snoise(p + t * 0.1);
        p *= 2.1;
        amp *= 0.5;
        t *= 1.1;
    }
    return f;
}

void main() {
    vec2 uv = v_uv;
    vec2 center = uv - 0.5;
    float aspect = u_resolution.x / u_resolution.y;
    center.x *= aspect;
    float t = u_time * 0.001;

    // Throb distortion
    float throb = u_throb;
    float dist = length(center);
    vec2 warp = center * (1.0 + throb * 0.03 * sin(dist * 8.0 - t * 2.0));
    uv = warp / vec2(aspect, 1.0) + 0.5;

    // Multi-scale noise
    float n1 = fbm(center * 3.0, t);
    float n2 = fbm(center * 1.5 + vec2(5.3, 1.7), t * 0.7);
    float n3 = snoise(center * 8.0 + t * 0.3);

    // Combine noise layers
    float n = n1 * 0.5 + n2 * 0.35 + n3 * 0.15;
    n = n * 0.5 + 0.5; // normalize to 0-1

    // Palette interpolation
    float idx = n * 3.0;
    int i0 = int(floor(idx));
    float frac_val = fract(idx);
    vec3 c;
    if (i0 == 0) c = mix(u_palette[0], u_palette[1], frac_val);
    else if (i0 == 1) c = mix(u_palette[1], u_palette[2], frac_val);
    else c = mix(u_palette[2], u_palette[3], frac_val);

    // Radial vignette
    float vig = 1.0 - dist * 0.8;
    c *= vig;

    // Feedback blend
    vec2 fbUv = uv + vec2(
        snoise(uv * 4.0 + t) * 0.003,
        snoise(uv * 4.0 + t + 100.0) * 0.003
    );
    vec3 prev = texture2D(u_prev, fbUv).rgb;
    c = mix(c, prev, u_feedback * 0.85);

    // Throb brightness
    c *= 1.0 + throb * 0.12;

    // Bath mode deepening — increase saturation and contrast
    if (u_bathDepth > 0.0) {
        float depth = min(u_bathDepth, 1.0);
        float lum = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(c, c * 1.3, depth * 0.3);
        c = mix(vec3(lum), c, 1.0 + depth * 0.4);
    }

    // Composite text overlay (pre-multiplied alpha)
    vec4 txt = texture2D(u_text, v_uv);
    c = mix(c, txt.rgb, txt.a);

    gl_FragColor = vec4(c, 1.0);
}`;

// Palettes for different presets
const PALETTES = {
    drift:   [[0.05,0.02,0.1], [0.15,0.08,0.3], [0.3,0.12,0.5], [0.1,0.05,0.2]],
    trance:  [[0.08,0.0,0.15], [0.5,0.0,0.6], [0.9,0.1,0.5], [0.3,0.0,0.4]],
    deep:    [[0.0,0.02,0.08], [0.0,0.05,0.2], [0.05,0.1,0.35], [0.0,0.03,0.12]],
    surge:   [[0.3,0.0,0.0], [0.8,0.2,0.0], [1.0,0.6,0.1], [0.5,0.05,0.0]],
    flesh:   [[0.15,0.05,0.03], [0.4,0.15,0.1], [0.6,0.25,0.2], [0.3,0.1,0.08]],
    sleep:   [[0.02,0.01,0.05], [0.05,0.03,0.12], [0.08,0.04,0.18], [0.03,0.02,0.08]],
    worship: [[0.1,0.06,0.0], [0.4,0.25,0.05], [0.7,0.5,0.15], [0.25,0.15,0.02]],
};

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        const gl = canvas.getContext('webgl', {
            alpha: false,
            antialias: false,
            preserveDrawingBuffer: false,
            powerPreference: 'high-performance',
        });
        if (!gl) throw new Error('WebGL not supported');
        this.gl = gl;

        this.feedbackIntensity = 0.5;
        this.performanceMode = false;
        this.palette = PALETTES.trance;
        this.throbPhase = 0;
        this.throb = 0;
        this.throbSpeed = 0.0015; // radians per ms
        this.width = canvas.width;
        this.height = canvas.height;

        this._initGL();
    }

    _initGL() {
        const gl = this.gl;

        // Compile shaders
        const vs = this._compileShader(gl.VERTEX_SHADER, VERT);
        const fs = this._compileShader(gl.FRAGMENT_SHADER, FRAG_MAIN);
        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);
        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            throw new Error('Shader link error: ' + gl.getProgramInfoLog(this.program));
        }

        // Fullscreen quad
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
        this.posLoc = gl.getAttribLocation(this.program, 'a_pos');

        // Uniforms
        gl.useProgram(this.program);
        this.u = {};
        for (const name of ['u_time','u_throb','u_resolution','u_feedback','u_prev','u_text','u_bathDepth']) {
            this.u[name] = gl.getUniformLocation(this.program, name);
        }
        this.u_palette = [];
        for (let i = 0; i < 4; i++) {
            this.u_palette[i] = gl.getUniformLocation(this.program, `u_palette[${i}]`);
        }

        // Feedback FBOs (ping-pong)
        this.fbos = [this._createFBO(), this._createFBO()];
        this.fboIndex = 0;

        // Text texture
        this.textTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.textTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        // Init with empty 1x1
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,0]));

        // Blit program (pass-through for rendering FBO to screen)
        const vsB = this._compileShader(gl.VERTEX_SHADER, VERT);
        const fsB = this._compileShader(gl.FRAGMENT_SHADER, FRAG_BLIT);
        this.blitProgram = gl.createProgram();
        gl.attachShader(this.blitProgram, vsB);
        gl.attachShader(this.blitProgram, fsB);
        gl.linkProgram(this.blitProgram);
        this.blitPosLoc = gl.getAttribLocation(this.blitProgram, 'a_pos');
        this.blitTexLoc = gl.getUniformLocation(this.blitProgram, 'u_tex');
    }

    _compileShader(type, src) {
        const gl = this.gl;
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            throw new Error('Shader compile error: ' + gl.getShaderInfoLog(s));
        }
        return s;
    }

    _createFBO() {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvas.width || 1, this.canvas.height || 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        return { fbo, tex };
    }

    resize(w, h) {
        this.width = w;
        this.height = h;
        this.gl.viewport(0, 0, w, h);
        // Recreate FBOs at new size
        const gl = this.gl;
        for (const fb of this.fbos) {
            gl.bindTexture(gl.TEXTURE_2D, fb.tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
    }

    setPreset(preset) {
        if (preset.palette && PALETTES[preset.palette]) {
            this.palette = PALETTES[preset.palette];
        } else if (preset.name && PALETTES[preset.name]) {
            this.palette = PALETTES[preset.name];
        }
        if (preset.throbSpeed !== undefined) this.throbSpeed = preset.throbSpeed;
    }

    uploadTextTexture(canvas2d) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.textTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas2d);
    }

    render(time, bathElapsed) {
        const gl = this.gl;

        // Update throb
        this.throbPhase += this.throbSpeed * 16.67; // approximate per-frame
        this.throb = Math.sin(this.throbPhase) * 0.5 + 0.5;

        const src = this.fbos[this.fboIndex];
        const dst = this.fbos[1 - this.fboIndex];

        // Render to dst FBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
        gl.viewport(0, 0, this.width, this.height);
        gl.useProgram(this.program);

        // Bind previous frame
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform1i(this.u.u_prev, 0);

        // Bind text texture
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.textTex);
        gl.uniform1i(this.u.u_text, 1);

        // Set uniforms
        gl.uniform1f(this.u.u_time, time);
        gl.uniform1f(this.u.u_throb, this.throb);
        gl.uniform2f(this.u.u_resolution, this.width, this.height);
        gl.uniform1f(this.u.u_feedback, this.feedbackIntensity);
        gl.uniform1f(this.u.u_bathDepth, Math.min(bathElapsed / 300, 1.0)); // 5 min to full depth

        for (let i = 0; i < 4; i++) {
            gl.uniform3fv(this.u_palette[i], this.palette[i]);
        }

        // Draw
        gl.enableVertexAttribArray(this.posLoc);
        gl.vertexAttribPointer(this.posLoc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Blit FBO to screen
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.width, this.height);
        gl.useProgram(this.blitProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, dst.tex);
        gl.uniform1i(this.blitTexLoc, 0);
        gl.enableVertexAttribArray(this.blitPosLoc);
        gl.vertexAttribPointer(this.blitPosLoc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        this.fboIndex = 1 - this.fboIndex;
    }
}
