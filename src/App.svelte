<script>
    import { onMount, onDestroy } from 'svelte';
    import { encodingForModel } from 'js-tiktoken';
    import { Moon, Sun, Copy, Check, ClipboardPaste } from 'lucide-svelte';

    let inputLog = '';
    let output = '';
    let files = [];
    let copyFeedback = '';

    // Processing state
    let isProcessing = false;

    // Drag and drop state
    let isDragging = false;
    let dragDepth = 0;

    let encoder;
    let encoderLoading = true;
    let inputTokens = 0;
    let outputTokens = 0;
    let tokenSavings = 0;
    let savingsPercent = 0;
    let componentDestroyed = false;
    let theme = 'light';
    let themePreference = null;
    let removeThemeListener = null;
    let fileInputEl;

    const createWorkerV3 = () => new Worker(new URL('./worker-logslimmer.js', import.meta.url), { type: 'module' });
    const createLogRecapWorker = () => new Worker(new URL('./worker-logrecap.js', import.meta.url), { type: 'module' });

    // Compression mode: 'log' | 'recap'
    let compressionMode = 'log'; // Default mode
    $: mainTitleSuffix = compressionMode === 'recap' ? 'Recap' : 'Slimmer';
    $: inputTitle = compressionMode === 'recap' ? 'Chat history input' : 'Log input';

    // Workers
    let workerV3; // Traditional clustering
    let workerLogRecap; // Log recap summarizer
    let pendingLogRecapCompression = null;

    // Worker selection based on mode
    $: activeWorker = compressionMode === 'recap' ? workerLogRecap : workerV3;

    // Debounce processing to avoid excessive computation while typing
    let debounceTimer = null;
    const DEBOUNCE_DELAY = 500; // 500ms delay

    function handleInput() {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
            if (inputLog.trim()) {
                compress(inputLog);
            }
        }, DEBOUNCE_DELAY);
    };

    const badgeBaseClass =
        'inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700/80 dark:bg-slate-800/70 dark:text-slate-300';

    const numberFormatter = new Intl.NumberFormat('en-US');

    function formatTokens(value) {
        if (!Number.isFinite(value)) return '0';
        return numberFormatter.format(Math.max(0, Math.round(value)));
    }

    function countTokens(text) {
        if (!encoder || !text) {
            return 0;
        }
        try {
            const tokens = encoder.encode(text);
            return tokens.length;
        } catch (error) {
            console.error('Failed to count tokens', error);
            return 0;
        }
    }

    function setTheme(value, persist = false) {
        if (typeof document === 'undefined') return;
        theme = value;
        const isDark = value === 'dark';
        const root = document.documentElement;
        root.classList.toggle('dark', isDark);
        root.dataset.theme = value;
        document.body?.classList.toggle('dark', isDark);

        if (persist && typeof window !== 'undefined') {
            themePreference = value;
            window.localStorage.setItem('themePreference', value);
        }
    }

    function toggleTheme() {
        // Always toggle between light and dark, overriding system preference
        const nextTheme = theme === 'dark' ? 'light' : 'dark';
        setTheme(nextTheme, true);
        // Force theme preference to override system detection
        themePreference = nextTheme;
    }

    function handlePickerClick() {
        if (fileInputEl) {
            fileInputEl.click();
        }
    }

    function formatFileSize(bytes) {
        if (!Number.isFinite(bytes)) return '';
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex += 1;
        }
        const formatted = size % 1 === 0 ? size : size.toFixed(1);
        return `${formatted} ${units[unitIndex]}`;
    }

    async function loadEncoder() {
        encoderLoading = true;
        try {
            const tokenizer = await encodingForModel('gpt-3.5-turbo');
            if (componentDestroyed) {
                tokenizer?.free?.();
                return;
            }
            if (encoder?.free) {
                encoder.free();
            }
            encoder = tokenizer;
        } catch (error) {
            console.error('Failed to load tokenizer', error);
            encoder = null;
        } finally {
            if (!componentDestroyed) {
                encoderLoading = false;
            }
        }
    }

    function initializeWorker() {
        // Initialize V3 worker (traditional clustering)
        if (workerV3) {
            workerV3.terminate();
        }

        try {
            workerV3 = createWorkerV3();
            setupWorkerHandlers(workerV3, 'v3');
        } catch (error) {
            console.error('[app] Failed to instantiate V3 worker:', error);
            output = `❌ Failed to start V3 worker: ${error instanceof Error ? error.message : String(error)}`;
            return;
        }

        if (workerLogRecap) {
            workerLogRecap.terminate();
        }
        try {
            workerLogRecap = createLogRecapWorker();
            setupWorkerHandlers(workerLogRecap, 'logrecap');
            if (compressionMode === 'recap' && pendingLogRecapCompression) {
                const pending = pendingLogRecapCompression;
                pendingLogRecapCompression = null;
                compress(pending);
            }
        } catch (error) {
            console.warn('[app] Log Recap worker not available:', error.message);
        }

        if (inputLog.trim().length > 0) {
            compress(inputLog);
        }
    }

    function setupWorkerHandlers(worker, type) {
        worker.onmessage = (e) => {
            const { type: msgType, data } = e.data;
            if (msgType === 'result') {
                output = data;
            } else if (msgType === 'error') {
                console.error(`Worker ${type} error:`, data);
                const fallbackMsg = type === 'logrecap' ?
                    'Try again or switch back to Log mode.' :
                    'Try again in a moment.';
                output = `❌ Processing error (${type}): ${data}\n\n${fallbackMsg}`;
            } else if (msgType === 'progress' && type === 'logrecap') {
                // Handle Log Recap progress updates
                const { chunk, total } = data;
                output = `Processing chunk ${chunk}/${total} with Log Recap...`;
            }
            isProcessing = false;
        };

        worker.onerror = (event) => {
            console.error(`Worker ${type} error event:`, event);
            output = `❌ Critical error in worker ${type}: ${event.message || event.error?.message || 'Unknown error'}\n\nReload the page and try again.`;
            isProcessing = false;
        };

    }

    function handleModeChange() {
        // Force re-compress current input if available (with a small delay to ensure reactive statements update)
        if (inputLog.trim()) {
            setTimeout(() => compress(inputLog), 0);
        }
    }

    onMount(() => {
        loadEncoder();
        initializeWorker();

        if (typeof window !== 'undefined') {
            const storedPreference = window.localStorage.getItem('themePreference');
            if (storedPreference === 'light' || storedPreference === 'dark') {
                themePreference = storedPreference;
                setTheme(storedPreference);
            }

            const media = window.matchMedia('(prefers-color-scheme: dark)');
            const handleChange = (event) => {
                if (themePreference) return;
                setTheme(event.matches ? 'dark' : 'light');
            };
            if (!themePreference) {
                setTheme(media.matches ? 'dark' : 'light');
            }
            media.addEventListener('change', handleChange);
            removeThemeListener = () => media.removeEventListener('change', handleChange);
        }
    });

    onDestroy(() => {
        componentDestroyed = true;
        if (workerV3) {
            workerV3.terminate();
        }
        if (workerLogRecap) {
            workerLogRecap.terminate();
        }
        if (encoder?.free) {
            encoder.free();
        }
        if (removeThemeListener) {
            removeThemeListener();
        }
        pendingLogRecapCompression = null;
    });

    function handleFileInput(event) {
        const input = event.target;
        addFiles(input.files);
        input.value = '';
    }

    function addFiles(fileList) {
        if (!fileList) return;
        const newEntries = Array.from(fileList).filter(Boolean);
        if (!newEntries.length) return;
        files = [...files, ...newEntries];
        processFiles();
    }

    async function processFiles() {
        const snapshot = [...files];
        if (snapshot.length === 0) {
            inputLog = '';
            output = '';
            return;
        }

        let combinedLog = '';
        const includeSeparators = snapshot.length > 1;

        for (const [index, file] of snapshot.entries()) {
            const text = await file.text();
            if (includeSeparators) {
                const label = `---- Document ${String(index + 1).padStart(2, '0')} (${file.name}) ----`;
                combinedLog += `${label}\n`;
            }
            combinedLog += `${text}\n\n`;
        }

        inputLog = combinedLog;
        compress(combinedLog);
    }

    function removeFile(index) {
        files = files.filter((_, i) => i !== index);
        if (files.length > 0) {
            processFiles();
        } else {
            inputLog = '';
            output = '';
            if (fileInputEl) {
                fileInputEl.value = '';
            }
        }
    }

    function handleDragEnter(event) {
        event.preventDefault();
        dragDepth += 1;
        isDragging = true;
    }

    function handleDragOver(event) {
        event.preventDefault();
        if (!isDragging) {
            isDragging = true;
        }
    }

    function handleDragLeave(event) {
        event.preventDefault();
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) {
            isDragging = false;
        }
    }

    function handleDrop(event) {
        event.preventDefault();
        dragDepth = 0;
        isDragging = false;
        const dropped = event.dataTransfer?.files;
        if (dropped && dropped.length > 0) {
            addFiles(dropped);
        }
        event.dataTransfer?.clearData?.();
    }

    function compress(text) {
        const needsAgentWorker = compressionMode === 'recap';
        if (needsAgentWorker && !workerLogRecap) {
            pendingLogRecapCompression = text;
            output = 'Loading Log Recap worker...';
            return;
        }
        if (!activeWorker) return;

        // Cancel any previous processing
        if (isProcessing) {
            return;
        }

        isProcessing = true;
        const processingMsg = needsAgentWorker
            ? 'Processing with Log Recap...'
            : 'Processing...';
        output = processingMsg;

        // Clear any pending debounce
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }

        // Send appropriate message based on mode
        if (needsAgentWorker) {
            workerLogRecap?.postMessage({
                type: 'compress-agent',
                data: text,
                options: {}
            });
        } else {
            activeWorker.postMessage({
                type: 'compress',
                data: text,
                options: {}
            });
        }

        pendingLogRecapCompression = null;
    }

    function clear() {
        inputLog = '';
        output = '';
        files = [];
        if (fileInputEl) {
            fileInputEl.value = '';
        }
    }

    async function copyText(text, type = 'output') {
        if (!text) {
            copyFeedback = 'Nothing to copy';
            setTimeout(() => (copyFeedback = ''), 2000);
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
            copyFeedback = `Copied ${type}!`;
            // Temporarily change button label and icon
            copyButtonState = { text: 'Copied!', icon: 'check' };
            setTimeout(() => {
                copyButtonState = { text: 'Copy', icon: 'copy' };
            }, 2000);
        } catch (error) {
            copyFeedback = 'Failed to copy';
        }

        setTimeout(() => {
            copyFeedback = '';
        }, 2000);
    }

    // Copy button state for dynamic label/icon changes
    let copyButtonState = { text: 'Copy', icon: 'copy' };
    let pasteButtonState = { text: 'Paste', status: 'idle' };

    async function copyOutput() {
        await copyText(output, 'output');
    }

    async function pasteFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (!text) {
                pasteButtonState = { text: 'Clipboard vazio', status: 'error' };
            } else {
                inputLog = text;
                pasteButtonState = { text: 'Pasted!', status: 'success' };
                handleInput();
            }
        } catch (error) {
            pasteButtonState = { text: 'Paste failed', status: 'error' };
        } finally {
            if (pasteButtonState.status !== 'idle') {
                setTimeout(() => {
                    pasteButtonState = { text: 'Paste', status: 'idle' };
                }, 2000);
            }
        }
    }

    $: inputTokens = encoder ? countTokens(inputLog) : 0;
    $: outputTokens = encoder && !isProcessing ? countTokens(output) : 0;
    $: tokenSavings = Math.max(inputTokens - outputTokens, 0);
    $: savingsPercent = inputTokens > 0 && tokenSavings > 0 ? Math.round((tokenSavings / inputTokens) * 100) : 0;
</script>

<main class="min-h-screen bg-slate-50 transition-colors duration-200 dark:bg-slate-950">
    <div class="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-8 lg:px-6">
        <header class="mb-8 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div class="space-y-2">
                <span class="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500 dark:border-slate-700/80 dark:bg-slate-900/80 dark:text-slate-300">Log intelligence toolkit</span>
                <h1 class="font-slabo text-3xl text-slate-900 dark:text-slate-100">
                    <span class="font-bold">log</span><span class="font-light">{mainTitleSuffix}</span>
                </h1>
                <p class="max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                    Intelligent log compression for AI agents. Reduce tokens without losing context.
                </p>
            </div>
            <div class="flex items-center gap-4 self-start">
                <div class="flex items-center gap-2">
                    <label class="relative inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        <span>Compression Mode</span>
                        <div class="flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
                            <button
                                type="button"
                                class="px-3 py-1 text-xs rounded-md transition-colors {compressionMode === 'log' ? 'bg-emerald-500 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'}"
                                on:click={() => { compressionMode = 'log'; handleModeChange(); }}
                            >
                                Log
                            </button>
                            <button
                                type="button"
                                class="px-3 py-1 text-xs rounded-md transition-colors {compressionMode === 'recap' ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'}"
                                on:click={() => { compressionMode = 'recap'; handleModeChange(); }}
                            >
                                Recap
                            </button>
                        </div>
                    </label>
                    <button
                        type="button"
                        class="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300 hover:text-slate-800 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-slate-100"
                        on:click={toggleTheme}
                    >
                        {#if theme === 'dark'}
                            <Sun size="16" aria-label="Switch to light mode" />
                        {:else}
                            <Moon size="16" aria-label="Switch to dark mode" />
                        {/if}
                    </button>
                </div>
            </div>
        </header>

        <div class="grid flex-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div class="space-y-6">
                <div class="rounded-md border border-slate-200 bg-white transition-colors duration-200 dark:border-slate-800 dark:bg-slate-900/60">
                    <div class="flex flex-col gap-4 p-5">
                        <div class="flex flex-wrap items-center justify-between gap-3">
                            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-100">{inputTitle}</h2>
                            {#if encoderLoading}
                                <span class={badgeBaseClass}>Calculating tokens...</span>
                            {:else}
                                <span class={`${badgeBaseClass} text-emerald-600 dark:text-emerald-400`}>
                                    Input tokens: {formatTokens(inputTokens)}
                                </span>
                            {/if}
                        </div>
                        <div class="space-y-3">
                            <div class="relative">
                                <div class="relative">
                                    <textarea
                                        id="inputLog"
                                        bind:value={inputLog}
                                        on:input={handleInput}
                                        placeholder="Paste your log or select files..."
                                        class="block h-64 w-full resize-none rounded-lg border border-slate-300 bg-white p-4 pr-12 text-sm font-mono text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus:border-emerald-400 dark:focus:ring-emerald-400"
                                        disabled={isProcessing}
                                    ></textarea>
                                    <button
                                        type="button"
                                        on:click={pasteFromClipboard}
                                        class="absolute right-3 top-3 inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                                        title="Paste from clipboard"
                                    >
                                        {#if pasteButtonState.status === 'success'}
                                            <Check size="12" />
                                        {:else}
                                            <ClipboardPaste size="12" />
                                        {/if}
                                        {pasteButtonState.text}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="flex flex-wrap justify-start gap-2">
                            <button
                                on:click={clear}
                                type="button"
                                class="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-slate-100"
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                </div>

                <div class="rounded-md border border-slate-200 bg-white transition-colors duration-200 dark:border-slate-800 dark:bg-slate-900/60">
                    <div class="flex flex-col gap-4 p-5">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-100">Semantic Compressed Output</h2>
                            <span
                                class={`${badgeBaseClass} ${outputTokens > 0 ? 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-800/70 dark:text-slate-400'}`}
                            >
                                Output tokens: {formatTokens(outputTokens)}{outputTokens > 0 ? ` (↓${savingsPercent}%)` : ''}
                            </span>
                        </div>
                        <div class="relative">
                            <pre class="max-h-[60vh] overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-4 pr-12 font-mono text-sm text-slate-800 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-100">{output || 'The result will appear here...'}</pre>
                            {#if output}
                                <button
                                    type="button"
                                    on:click={copyOutput}
                                    class="absolute right-3 top-3 inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                                    title="Copy output"
                                >
                                    {#if copyButtonState.icon === 'check'}
                                        <Check size="12" />
                                    {:else}
                                        <Copy size="12" />
                                    {/if}
                                    {copyButtonState.text}
                                </button>
                            {/if}
                        </div>
                    </div>
                </div>
            </div>

            <aside
                class={`rounded-md border border-slate-200 bg-white transition-colors duration-200 dark:border-slate-800 dark:bg-slate-900/60 ${isDragging ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-slate-50 dark:ring-offset-slate-950' : ''}`}
                on:dragenter={handleDragEnter}
                on:dragover={handleDragOver}
                on:dragleave={handleDragLeave}
                on:drop={handleDrop}
            >
                <div class="flex h-full flex-col gap-4 p-5">
                    <div class="flex items-center justify-between">
                        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-100">Documents</h2>
                        {#if files.length > 0}
                            <span class={badgeBaseClass}>{files.length} files</span>
                        {/if}
                    </div>
                    <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        Uploaded files are merged in sequence with document separators.
                    </p>
                    <div class="flex-1 overflow-hidden">
                        {#if files.length === 0}
                            <div class="flex h-full flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400 transition dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-500">
                                <p>Drop files here or use the picker below.</p>
                                <p class="mt-1 text-xs text-slate-300 dark:text-slate-600">TXT, LOG, MD or CSV</p>
                                <button
                                    type="button"
                                    class="mt-3 inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-slate-100"
                                    on:click={handlePickerClick}
                                >
                                    Or upload files
                                </button>
                            </div>
                        {:else}
                            <ul class="divide-y divide-slate-200 overflow-auto rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                                {#each files as file, index}
                                    <li class="flex items-center justify-between gap-3 px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                                        <div class="min-w-0 flex-1">
                                            <p class="truncate font-medium text-slate-700 dark:text-slate-100" title={file.name}>{file.name}</p>
                                            <p class="text-xs text-slate-400 dark:text-slate-500">{formatFileSize(file.size)}</p>
                                        </div>
                                        <button
                                            type="button"
                                            class="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-[11px] font-medium text-slate-500 transition hover:border-red-300 hover:text-red-500 dark:border-slate-700 dark:text-slate-400 dark:hover:border-red-400 dark:hover:text-red-400"
                                            on:click={() => removeFile(index)}
                                        >
                                            Remove
                                        </button>
                                    </li>
                                {/each}
                                <li class="px-4 py-3">
                                    <button
                                        type="button"
                                        class="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-slate-100"
                                        on:click={handlePickerClick}
                                    >
                                        Add more files
                                    </button>
                                </li>
                            </ul>
                        {/if}
                    </div>
                    <input
                            id="fileInput"
                            type="file"
                            multiple
                            accept=".txt,.log,.md,.csv"
                            on:change={handleFileInput}
                            bind:this={fileInputEl}
                            class="sr-only"
                        />
                    <p class="text-center text-xs text-slate-400 dark:text-slate-500">Drag files anywhere in this panel.</p>
                </div>
            </aside>
        </div>
    </div>
</main>

<style>
    :global(body) {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

:global(.font-slabo) {
        font-family: 'Slabo 13px', serif;
    }
</style>
