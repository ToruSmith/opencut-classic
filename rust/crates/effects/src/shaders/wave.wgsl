struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 波浪扭曲:沿指定方向傳播的正弦波,把畫面垂直於波的方向推動。
// scalars   = (振幅 像素, 波長 像素, 速度 週期/秒, 方向 度)
// direction = (時間 秒, 未使用)
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

const TAU: f32 = 6.2831853;

// 超出 0..1 的取樣點鏡像回來,不露出邊緣
fn mirror_uv(uv: vec2f) -> vec2f {
    return vec2f(1.0) - abs(fract(uv * 0.5) * 2.0 - vec2f(1.0));
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let amplitude = max(uniforms.scalars.x, 0.0);
    let wavelength = max(uniforms.scalars.y, 8.0);
    let speed = uniforms.scalars.z;
    let angle = radians(uniforms.scalars.w);
    let time = max(uniforms.direction.x, 0.0);
    let resolution = uniforms.resolution;

    let dir = vec2f(cos(angle), sin(angle));
    let perpendicular = vec2f(-dir.y, dir.x);
    let pixel = input.tex_coord * resolution;
    let phase = dot(pixel, dir) / wavelength * TAU - time * speed * TAU;
    let offset = perpendicular * sin(phase) * amplitude;
    let uv = mirror_uv((pixel + offset) / resolution);
    return textureSample(input_texture, input_sampler, uv);
}
