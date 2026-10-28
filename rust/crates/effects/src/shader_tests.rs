//! 在 CI 驗證所有效果 shader 是合法的 WGSL。
//!
//! 瀏覽器只會在第一次建立管線時才編譯 shader,而且任何一個 shader 有錯,
//! 整個 `EffectPipeline::new` 都會失敗,所有效果一起壞掉。把檢查提早到這裡。

use naga::valid::{Capabilities, ValidationFlags, Validator};

const SHADERS: &[(&str, &str)] = &[
    ("gaussian_blur", include_str!("shaders/gaussian_blur.wgsl")),
    ("color_grade", include_str!("shaders/color_grade.wgsl")),
    ("tone", include_str!("shaders/tone.wgsl")),
    ("chroma_key", include_str!("shaders/chroma_key.wgsl")),
    ("sharpen", include_str!("shaders/sharpen.wgsl")),
    ("glow", include_str!("shaders/glow.wgsl")),
    ("split_tone", include_str!("shaders/split_tone.wgsl")),
    ("pixelate", include_str!("shaders/pixelate.wgsl")),
    (
        "chromatic_aberration",
        include_str!("shaders/chromatic_aberration.wgsl"),
    ),
    ("posterize", include_str!("shaders/posterize.wgsl")),
    ("film_grain", include_str!("shaders/film_grain.wgsl")),
    ("lut", include_str!("shaders/lut.wgsl")),
    ("camera_shake", include_str!("shaders/camera_shake.wgsl")),
    ("zoom_blur", include_str!("shaders/zoom_blur.wgsl")),
    ("glitch", include_str!("shaders/glitch.wgsl")),
    ("mirror", include_str!("shaders/mirror.wgsl")),
    ("wipe", include_str!("shaders/wipe.wgsl")),
    ("cut_motion", include_str!("shaders/cut_motion.wgsl")),
    ("halftone", include_str!("shaders/halftone.wgsl")),
    ("duotone", include_str!("shaders/duotone.wgsl")),
    ("vhs", include_str!("shaders/vhs.wgsl")),
    ("speed_lines", include_str!("shaders/speed_lines.wgsl")),
    ("wave", include_str!("shaders/wave.wgsl")),
    ("light_leak", include_str!("shaders/light_leak.wgsl")),
    ("fisheye", include_str!("shaders/fisheye.wgsl")),
];

#[test]
fn every_effect_shader_is_valid_wgsl() {
    for (name, source) in SHADERS {
        let module = naga::front::wgsl::parse_str(source)
            .unwrap_or_else(|error| panic!("{name}: {}", error.emit_to_string(source)));

        Validator::new(ValidationFlags::all(), Capabilities::empty())
            .validate(&module)
            .unwrap_or_else(|error| panic!("{name}: {error:?}"));

        assert!(
            module
                .entry_points
                .iter()
                .any(|entry| entry.name == "fragment_main"),
            "{name}: missing fragment_main entry point"
        );
    }
}
