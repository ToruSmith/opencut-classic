struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// direction.x = sepia amount (0..1), direction.y = vignette amount (0..1)
// scalars = (brightness [-1..1], contrast [0..2], saturation [0..2], hue shift in degrees)
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

fn luma(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn hue_rotate(c: vec3f, degrees: f32) -> vec3f {
    let a = radians(degrees);
    let cs = cos(a);
    let sn = sin(a);
    // Rotation around the gray axis (same matrix family as the CSS hue-rotate filter).
    let m = mat3x3f(
        vec3f(0.213 + cs * 0.787 - sn * 0.213, 0.213 - cs * 0.213 + sn * 0.143, 0.213 - cs * 0.213 - sn * 0.787),
        vec3f(0.715 - cs * 0.715 - sn * 0.715, 0.715 + cs * 0.285 + sn * 0.140, 0.715 - cs * 0.715 + sn * 0.715),
        vec3f(0.072 - cs * 0.072 + sn * 0.928, 0.072 - cs * 0.072 - sn * 0.283, 0.072 + cs * 0.928 + sn * 0.072)
    );
    return m * c;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let src = textureSample(input_texture, input_sampler, input.tex_coord);
    // The compositor works with premultiplied alpha; grade the straight color.
    var rgb = select(vec3f(0.0), src.rgb / src.a, src.a > 0.0001);

    rgb = rgb + vec3f(uniforms.scalars.x);
    rgb = (rgb - vec3f(0.5)) * uniforms.scalars.y + vec3f(0.5);
    let l = luma(rgb);
    rgb = mix(vec3f(l), rgb, uniforms.scalars.z);
    if (abs(uniforms.scalars.w) > 0.001) {
        rgb = hue_rotate(rgb, uniforms.scalars.w);
    }

    let sepia_rgb = vec3f(
        dot(rgb, vec3f(0.393, 0.769, 0.189)),
        dot(rgb, vec3f(0.349, 0.686, 0.168)),
        dot(rgb, vec3f(0.272, 0.534, 0.131))
    );
    rgb = mix(rgb, sepia_rgb, uniforms.direction.x);

    let centered = input.tex_coord - vec2f(0.5);
    let vignette = 1.0 - uniforms.direction.y * smoothstep(0.25, 0.85, length(centered) * 1.414);
    rgb = rgb * vignette;

    rgb = clamp(rgb, vec3f(0.0), vec3f(1.0));
    return vec4f(rgb * src.a, src.a);
}
