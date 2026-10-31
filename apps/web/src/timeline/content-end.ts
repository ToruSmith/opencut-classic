/**
 * 時間軸「有實際內容」的結尾(純函式,有測試)。
 *
 * 特效片段只是蓋在別的片段上面,自己不產生畫面或聲音,所以**不該撐長時間軸**:
 * 以前把影片從時間軸拿掉後,留在特效軌上的小片段仍讓總長是 3:23,
 * 時間軸看起來空了、播放卻還在黑畫面上跑。
 * 沒有任何非特效片段時回傳 0(視為空時間軸)。
 */
interface ElementLike {
	type: string;
	startTime: number;
	duration: number;
}

interface TrackLike {
	elements: ReadonlyArray<ElementLike>;
}

export function computeContentEnd({
	tracks,
}: {
	tracks: {
		overlay: ReadonlyArray<TrackLike>;
		main: TrackLike;
		audio: ReadonlyArray<TrackLike>;
	};
}): number {
	let maxEnd = 0;
	for (const track of [...tracks.overlay, tracks.main, ...tracks.audio]) {
		for (const element of track.elements) {
			if (element.type === "effect") continue;
			const end = element.startTime + element.duration;
			if (end > maxEnd) maxEnd = end;
		}
	}
	return maxEnd;
}
