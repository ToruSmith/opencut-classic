import { useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";

/**
 * 站內導覽。回傳的物件身分保持穩定,
 * 避免放進 effect 依賴陣列時,在每次換頁後重複觸發。
 * (react-router 的 useNavigate 在路由改變時會換新函式。)
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
		}),
		[],
	);
}
