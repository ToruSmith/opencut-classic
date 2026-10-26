struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 放射模糊 / 拉近模糊(類似 Kdenlive 的 Radial blur、CapCut 的「衝擊」)
// scalars   = (強度 0..1, 中心 x 0..1, 中心 y 0..1, 0)
// direction = 未使用
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

const SAMPLES: i32 = 32;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let strength = clamp(uniforms.scalars.x, 0.0, 1.0);
    let center = uniforms.scalars.yz;
    let uv = input.tex_coord;
    let toward_center = center - uv;

    // 取樣點從原位置往中心排開;權重線性遞減,原位置最清楚。
    // 迴圈次數固定,屬於一致控制流程,textureSample 可以放在裡面
    var color = vec4f(0.0);
    var total = 0.0;
    for (var index = 0; index < SAMPLES; index = index + 1) {
        let t = f32(index) / f32(SAMPLES - 1);
        let weight = 1.0 - t * 0.6;
        color = color + textureSample(input_texture, input_sampler, uv + toward_center * t * strength * 0.5) * weight;
        total = total + weight;
    }
    // 預乘 alpha 下平均是線性運算
    return color / total;
}
