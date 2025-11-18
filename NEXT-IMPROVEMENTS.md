# Próximas Melhorias Algorítmicas no LogSlimmer

## 1. Otimização de Clustering
- **Problema**: Algoritmos atuais em `strategies/text-based-strategy.js` e `cluster-builder-no-embeddings.js` têm complexidade O(n²) devido a comparações pairwise.
- **Solução**: Implementar clustering hierárquico com estruturas de dados como KD-trees ou hashing (ex.: MinHash para similaridade Jaccard), reduzindo para O(n log n).
- **Ganho esperado**: 50-70% redução em tempo para datasets >10k eventos.

## 2. Paralelização de Similaridade
- **Problema**: Cálculos em `similarity-utils.js` (Jaccard, TF-IDF) são sequenciais.
- **Solução**: Usar Web Workers para paralelizar comparações em batches, aproveitando múltiplos núcleos.
- **Ganho esperado**: 30-50% aceleração em processamento de logs grandes.

## 3. Cache Inteligente e Memoização
- **Problema**: Recálculos desnecessários em `tfidf-cache.js` e `tokenization-cache.js`.
- **Solução**: Implementar LRU cache com hashing de entrada e invalidação automática baseada em tamanho.
- **Ganho esperado**: 20-40% economia em tokenização repetida.

## 4. Estruturas de Dados Otimizadas
- **Problema**: Uso de arrays simples em `array-sampling.js` leva a buscas lineares.
- **Solução**: Migrar para Maps/Sets ou arrays tipados para lookups O(1).
- **Ganho esperado**: 10-20% melhoria em amostragem e agregação.

## 5. Compressão de Estado
- **Problema**: Eventos grandes consomem memória em `log-processor.js`.
- **Solução**: Usar compressão LZ4 ou similar para armazenar linhas processadas temporariamente.
- **Ganho esperado**: 15-25% redução em uso de RAM para inputs >100k tokens.

Essas mudanças priorizam eficiência assintótica sobre micro-otimizações, focando no pipeline de compressão. Implemente incrementalmente com benchmarks.