import { useMemo, useRef } from "react";
import {
	useLocation,
	useNavigate,
	useParams as useRouterParams,
} from "react-router-dom";

/**
 * 取代 `next/navigation`。
 * useRouter 回傳的物件身分保持穩定（與 Next 行為一致），
 * 避免放進 effect 依賴陣列時在每次換頁後重複觸發。
 */
export function useRouter() {
	const navigate = useNavigate();
	const navigateRef = useRef(navigate);
	navigateRef.current = navigate;

	return useMemo(
		() => ({
			push: (to: string) => navigateRef.current(to),
			replace: (to: string) => navigateRef.current(to, { replace: true }),
			back: () => navigateRef.current(-1),
			forward: () => navigateRef.current(1),
			refresh: () => window.location.reload(),
			prefetch: (_to: string) => {},
		}),
		[],
	);
}

export function useParams<
	T extends Record<string, string | string[] | undefined> = Record<
		string,
		string | undefined
	>,
>() {
	return useRouterParams() as unknown as T;
}

export function usePathname() {
	return useLocation().pathname;
}
