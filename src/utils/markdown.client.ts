let processorReady: Promise<{
	process: (source: string) => Promise<unknown>;
}> | undefined;

async function getProcessor() {
	if (!processorReady) {
		processorReady = import("./remark").then(({ default: processor }) => processor);
	}

	return processorReady;
}

export async function renderMarkdown(source: string): Promise<string> {
	const processor = await getProcessor();
	return String(await processor.process(source));
}
