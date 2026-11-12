import { pipeline, env, type PipelineType } from '@huggingface/transformers';
env.allowLocalModels = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.wasmPaths = '/ai-assets/';
}
const cache = new Map<string, unknown>();
type Runner = (...args: unknown[]) => Promise<unknown>;
self.onmessage = async (
  event: MessageEvent<{
    task: string;
    text: string;
    question: string;
    audio?: Float32Array;
    image?: string;
  }>,
) => {
  try {
    const { task, text, question, audio, image } = event.data;
    const definitions: Record<string, [PipelineType, string]> = {
      chat: [
        'question-answering',
        'Xenova/distilbert-base-cased-distilled-squad',
      ],
      summary: ['summarization', 'Xenova/distilbart-cnn-6-6'],
      audio: ['automatic-speech-recognition', 'Xenova/whisper-tiny.en'],
      handwriting: ['image-to-text', 'Xenova/trocr-small-handwritten'],
    };
    const [kind, model] = definitions[task];
    let runner = cache.get(task) as Runner | undefined;
    if (!runner) {
      self.postMessage({
        status:
          'Loading AI model. The first download may take several minutes…',
      });
      runner = (await pipeline(kind, model, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: (p: unknown) => {
          const item = p as { status?: string; progress?: number };
          if (item.progress !== undefined)
            self.postMessage({
              status: 'Downloading model: ' + Math.round(item.progress) + '%',
            });
        },
      })) as unknown as Runner;
      cache.set(task, runner);
    }
    self.postMessage({ status: 'Processing on your device…' });
    if (task === 'audio') {
      const result = (await runner(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
      })) as { text: string };
      self.postMessage({ result: result.text });
    } else if (task === 'handwriting') {
      const result = (await runner(image, { max_new_tokens: 128 })) as {
        generated_text: string;
      }[];
      self.postMessage({
        result: result.map((x) => x.generated_text).join('\n'),
      });
    } else if (task === 'summary') {
      const chunks = text.match(/[\s\S]{1,2500}/g) || [];
      if (chunks.length > 40)
        throw new Error(
          'Choose fewer than 100,000 text characters for summarization.',
        );
      const results = [];
      for (let i = 0; i < chunks.length; i++) {
        self.postMessage({
          status: `Summarizing section ${i + 1} of ${chunks.length}…`,
        });
        const r = (await runner(chunks[i], { max_new_tokens: 120 })) as {
          summary_text: string;
        }[];
        results.push(r[0].summary_text);
      }
      self.postMessage({ result: results.join('\n\n') });
    } else {
      const words = question.toLowerCase().match(/\w{3,}/g) || [];
      const chunks = (text.match(/[\s\S]{1,1500}/g) || [])
        .map((chunk, i) => ({
          chunk,
          i,
          score: words.reduce(
            (sum, w) => sum + (chunk.toLowerCase().includes(w) ? 1 : 0),
            0,
          ),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      let best = {
        answer: 'No answer found in the selected document.',
        score: 0,
      };
      for (const c of chunks) {
        const result = (await runner(question, c.chunk)) as {
          answer: string;
          score: number;
        };
        if (result.score > best.score) best = result;
      }
      self.postMessage({
        result:
          best.answer +
          '\n\nExtracted from the closest matching passages. Verify the answer against your document.',
      });
    }
  } catch (e) {
    self.postMessage({
      error:
        e instanceof Error
          ? e.message
          : 'AI processing failed. Try a smaller file or another browser.',
    });
  }
};
