/**
 * Reconstructs the scenario by interleaving story markers with relevant context events.
 * This restores the chronological narrative of cause and effect.
 */

import { getConfig } from '../config.js'

const CONTEXT_PATTERNS = getConfig().contextPatterns || []

/**
 * Checks if an event is a "Context Event" that should be included in the story.
 * 
 * @param {object} event - The log event
 * @returns {boolean}
 */
export function isContextEvent(event) {
  if (!event || !event.processedLines || event.processedLines.length === 0) return false
  
  // Check against configured patterns
  const text = event.processedLines.join(' ')
  return CONTEXT_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * Builds the scenario reconstruction section.
 * 
 * @param {Array} allEvents - All events sorted by order
 * @returns {object} { storyText: string, usedEventIds: Set<number> }
 */
export function reconstructScenario(allEvents) {
  const usedEventIds = new Set()
  const scenarioLines = []
  
  // Sort events by original order to ensure chronology
  const sortedEvents = [...allEvents].sort((a, b) => a.order - b.order)
  
  let currentStoryBlock = null
  
  for (const event of sortedEvents) {
    // 1. Identify Story Markers (Explicit User Annotations)
    if (event.primaryCategory === 'Story') {
      currentStoryBlock = event
      usedEventIds.add(event.order) // Assuming order is unique enough for ID in this context
      
      // Add distinct visual separator for new story steps
      if (scenarioLines.length > 0) scenarioLines.push('')
      scenarioLines.push(...event.processedLines)
      continue
    }
    
    // 2. Identify Context Events (Implicit Application Logic)
    // Only add if we are inside a story block (after at least one marker)
    if (currentStoryBlock && isContextEvent(event)) {
      usedEventIds.add(event.order)
      // Indent context events to show they belong to the step
      const indentedLines = event.processedLines.map(line => `  ${line}`)
      scenarioLines.push(...indentedLines)
    }
  }
  
  return {
    storyText: scenarioLines.length > 0 
      ? '## Scenario Reconstruction\n' + scenarioLines.join('\n') 
      : '',
    usedEventIds
  }
}
