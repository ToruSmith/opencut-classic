const MASTER_LIMITER_THRESHOLD_DB = -1;
const MASTER_LIMITER_KNEE_DB = 0;
const MASTER_LIMITER_RATIO = 20;
const MASTER_LIMITER_ATTACK_SECONDS = 0.001;
const MASTER_LIMITER_RELEASE_SECONDS = 0.12;
// 預覽用的限幅鏈。匯出走 media/audio-mixer.ts 的串流限幅器(天花板同為 0.98)。
const MASTER_OUTPUT_HEADROOM = 0.98;

export function createAudioMasteringChain({
	audioContext,
	destination,
}: {
	audioContext: AudioContext | OfflineAudioContext;
	destination: AudioNode;
}): {
	input: GainNode;
} {
	const input = audioContext.createGain();
	const limiter = audioContext.createDynamicsCompressor();
	const outputGain = audioContext.createGain();

	limiter.threshold.value = MASTER_LIMITER_THRESHOLD_DB;
	limiter.knee.value = MASTER_LIMITER_KNEE_DB;
	limiter.ratio.value = MASTER_LIMITER_RATIO;
	limiter.attack.value = MASTER_LIMITER_ATTACK_SECONDS;
	limiter.release.value = MASTER_LIMITER_RELEASE_SECONDS;
	outputGain.gain.value = MASTER_OUTPUT_HEADROOM;

	input.connect(limiter);
	limiter.connect(outputGain);
	outputGain.connect(destination);

	return { input };
}
