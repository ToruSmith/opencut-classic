import type { CSSProperties, ImgHTMLAttributes } from "react";

/**
 * 取代 `next/image`：直接輸出 <img>。
 * 以「/」開頭的站內路徑會補上部署根路徑（BASE_URL），讓子目錄部署也能運作。
 */
type ImageProps = Omit<
	ImgHTMLAttributes<HTMLImageElement>,
	"src" | "width" | "height"
> & {
	src: string;
	width?: number;
	height?: number;
	fill?: boolean;
	priority?: boolean;
	unoptimized?: boolean;
	quality?: number;
	placeholder?: string;
};

const resolveSrc = (src: string) =>
	src.startsWith("/") && !src.startsWith("//")
		? `${import.meta.env.BASE_URL}${src.slice(1)}`
		: src;

export default function Image({
	src,
	fill,
	priority,
	unoptimized: _unoptimized,
	quality: _quality,
	placeholder: _placeholder,
	width,
	height,
	style,
	alt,
	...rest
}: ImageProps) {
	const fillStyle: CSSProperties | undefined = fill
		? {
				position: "absolute",
				inset: 0,
				width: "100%",
				height: "100%",
				...style,
			}
		: style;
	return (
		<img
			src={resolveSrc(src)}
			alt={alt ?? ""}
			width={fill ? undefined : width}
			height={fill ? undefined : height}
			loading={priority ? "eager" : "lazy"}
			style={fillStyle}
			{...rest}
		/>
	);
}
