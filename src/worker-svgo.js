import { optimize } from 'svgo/browser';

self.onmessage = (e) => {
    const { type, data, options } = e.data;

    if (type === 'compress') {
        try {
            const result = optimize(data, {
                // Mantém o formato multilinha para legibilidade da IA
                js2svg: {
                    pretty: true,
                    indent: 1 // Indentação mínima para economizar tokens de espaço
                },
                plugins: [
                    // Presets padrões (remove comentários, doctypes, metadados inúteis)
                    {
                        name: 'preset-default',
                        params: {
                            overrides: {
                                // Remove a tag <title> e <desc> se não forem cruciais
                                removeTitle: true,
                                removeDesc: true,
                                // NÃO remove o viewBox (essencial para IA entender proporção)
                                removeViewBox: false,
                            },
                        },
                    },
                    // Converte estilos CSS inline (style="...") para atributos (fill="...")
                    // Isso economiza MUITOS tokens removendo redundâncias
                    'convertStyleToAttrs',

                    // Remove atributos que não afetam a renderização visual
                    'removeScriptElement',
                    'removeDimensions', // Remove width/height se viewBox existir (IA prefere viewBox)

                    // O GRANDE OTIMIZADOR DE TOKENS: Redução de precisão nos caminhos
                    {
                        name: 'convertPathData',
                        params: {
                            floatPrecision: 1,  // 1 casa decimal é suficiente para IAs "imaginarem"
                            transformPrecision: 1,
                            makeArcs: undefined,
                            noSpaceAfterFlags: true, // Remove espaços desnecessários em paths
                        }
                    },
                    // Arredonda números em outros atributos (x, y, width, etc)
                    {
                        name: 'cleanupNumericValues',
                        params: {
                            floatPrecision: 1,
                        }
                    }
                ],
            });

            self.postMessage({
                type: 'result',
                data: result.data
            });

        } catch (error) {
            self.postMessage({
                type: 'error',
                data: error.message
            });
        }
    }
};
