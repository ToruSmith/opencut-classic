struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 鏡像(類似 Kdenlive / Shotcut 的 Mirror):把一半畫面對折到另一半
// scalars   = (模式 0=左右 1=上下 2=四格, 保留另一半 0/1, 0, 0)
// direction = 未使用
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

fn fold(coordinate: f32, keep_second_half: bool) -> f32 {
    if keep_second_half {
        return select(1.0 - coordinate, coordinate, coordinate > 0.5);
    }
    return select(coordinate, 1.0 - coordinate, coordinate > 0.5);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let mode = u32(clamp(uniforms.scalars.x, 0.0, 2.0) + 0.5);
    let keep_second_half = uniforms.scalars.y > 0.5;
    var uv = input.tex_coord;
    if mode == 0u || mode == 2u {
        uv.x = fold(uv.x, keep_second_half);
    }
    if mode == 1u || mode == 2u {
        uv.y = fold(uv.y, keep_second_half);
    }
    return textureSample(input_texture, input_sampler, uv);
}
