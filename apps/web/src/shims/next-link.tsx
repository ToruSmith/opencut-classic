import { forwardRef, type AnchorHTMLAttributes } from "react";
import { Link as RouterLink } from "react-router-dom";

/**
 * 取代 `next/link`：站內連結走 React Router，外部連結用一般 <a>。
 */
type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
	href: string;
	prefetch?: boolean;
	scroll?: boolean;
	replace?: boolean;
};

const isExternal = (href: string) =>
	/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href);

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
	{ href, prefetch: _prefetch, scroll: _scroll, replace, children, ...rest },
	ref,
) {
	if (isExternal(href)) {
		return (
			<a ref={ref} href={href} {...rest}>
				{children}
			</a>
		);
	}
	return (
		<RouterLink ref={ref} to={href} replace={replace} {...rest}>
			{children}
		</RouterLink>
	);
});

export default Link;
