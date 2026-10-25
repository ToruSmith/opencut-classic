"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useStoragePersistence } from "@/services/storage/use-storage-persistence";

export function StoragePersistenceDialog() {
	const { showDialog, onConfirm, onDismiss } = useStoragePersistence();

	return (
		<Dialog open={showDialog} onOpenChange={(open) => !open && onDismiss()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>別弄丟你的專案</DialogTitle>
				</DialogHeader>
				<DialogBody>
					<p className="text-base text-muted-foreground">
						儲存空間不足時,瀏覽器可能自動刪除你的專案。
					</p>
					<p className="text-base text-muted-foreground">
						是否允許保護這些專案?
					</p>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={onDismiss}>
						稍後再說
					</Button>
					<Button onClick={onConfirm}>允許</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
