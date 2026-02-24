/**
 * Markdown Chunking Service
 * Splits markdown files into chunks for embedding.
 * Respects heading boundaries and tracks line numbers.
 *
 * @module memory/chunker
 */

import { createHash } from 'crypto'

export interface ChunkResult {
  text: string
  heading: string | null // Nearest H1/H2 heading above chunk
  startLine: number
  endLine: number
  hash: string // SHA256 of chunk text
}

export interface ChunkerOptions {
  maxChars?: number // Default: 1600 (~400 tokens)
  overlapChars?: number // Default: 320 (~80 tokens)
}

const DEFAULT_MAX_CHARS = 1600
const DEFAULT_OVERLAP_CHARS = 320

/**
 * Chunk markdown text into overlapping segments.
 * - Respects H1/H2 heading boundaries (never splits mid-section)
 * - Tracks the nearest heading for each chunk
 * - Returns line numbers for source attribution
 */
export function chunkMarkdown(content: string, options: ChunkerOptions = {}): ChunkResult[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS

  const lines = content.split('\n')
  const sections = splitIntoSections(lines)
  const chunks: ChunkResult[] = []

  for (const section of sections) {
    const sectionChunks = chunkSection(section, maxChars, overlapChars)
    chunks.push(...sectionChunks)
  }

  return chunks
}

interface Section {
  heading: string | null
  lines: string[]
  startLine: number // 1-indexed
}

/**
 * Split content into sections by H1/H2 headings.
 * Each section includes its heading and all content until the next H1/H2.
 */
function splitIntoSections(lines: string[]): Section[] {
  const sections: Section[] = []
  let currentSection: Section = {
    heading: null,
    lines: [],
    startLine: 1,
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const headingMatch = line.match(/^(#{1,2})\s+(.+)$/)

    if (headingMatch) {
      // Save current section if it has content
      if (currentSection.lines.length > 0) {
        sections.push(currentSection)
      }

      // Start new section with this heading
      currentSection = {
        heading: headingMatch[2].trim(),
        lines: [line],
        startLine: i + 1, // 1-indexed
      }
    } else {
      currentSection.lines.push(line)
    }
  }

  // Don't forget the last section
  if (currentSection.lines.length > 0) {
    sections.push(currentSection)
  }

  return sections
}

/**
 * Chunk a single section into overlapping segments.
 * Preserves paragraph boundaries when possible.
 */
function chunkSection(section: Section, maxChars: number, overlapChars: number): ChunkResult[] {
  const text = section.lines.join('\n')

  // If section fits in one chunk, return as-is
  if (text.length <= maxChars) {
    if (text.trim().length === 0) return []
    return [
      {
        text: text.trim(),
        heading: section.heading,
        startLine: section.startLine,
        endLine: section.startLine + section.lines.length - 1,
        hash: hashText(text.trim()),
      },
    ]
  }

  // Split into paragraphs
  const paragraphs = splitIntoParagraphs(section.lines, section.startLine)
  const chunks: ChunkResult[] = []

  let currentChunk: string[] = []
  let currentChunkStart = section.startLine
  let currentChunkEnd = section.startLine
  let currentLength = 0

  for (const para of paragraphs) {
    const paraText = para.text
    const paraLength = paraText.length

    // If adding this paragraph exceeds max, save current chunk and start new one
    if (currentLength + paraLength > maxChars && currentChunk.length > 0) {
      const chunkText = currentChunk.join('\n\n').trim()
      if (chunkText.length > 0) {
        chunks.push({
          text: chunkText,
          heading: section.heading,
          startLine: currentChunkStart,
          endLine: currentChunkEnd,
          hash: hashText(chunkText),
        })
      }

      // Start new chunk with overlap from previous
      const overlap = getOverlapText(currentChunk, overlapChars)
      currentChunk = overlap.length > 0 ? [overlap] : []
      currentChunkStart = para.startLine
      currentLength = overlap.length
    }

    currentChunk.push(paraText)
    currentChunkEnd = para.endLine
    currentLength += paraLength + 2 // +2 for paragraph separator
  }

  // Save final chunk
  if (currentChunk.length > 0) {
    const chunkText = currentChunk.join('\n\n').trim()
    if (chunkText.length > 0) {
      chunks.push({
        text: chunkText,
        heading: section.heading,
        startLine: currentChunkStart,
        endLine: currentChunkEnd,
        hash: hashText(chunkText),
      })
    }
  }

  return chunks
}

interface Paragraph {
  text: string
  startLine: number
  endLine: number
}

/**
 * Split lines into paragraphs (separated by blank lines).
 */
function splitIntoParagraphs(lines: string[], baseLineNumber: number): Paragraph[] {
  const paragraphs: Paragraph[] = []
  let currentPara: string[] = []
  let paraStart = baseLineNumber

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = baseLineNumber + i

    if (line.trim() === '') {
      // Blank line — end current paragraph
      if (currentPara.length > 0) {
        paragraphs.push({
          text: currentPara.join('\n'),
          startLine: paraStart,
          endLine: lineNum - 1,
        })
        currentPara = []
      }
      paraStart = lineNum + 1
    } else {
      if (currentPara.length === 0) {
        paraStart = lineNum
      }
      currentPara.push(line)
    }
  }

  // Don't forget the last paragraph
  if (currentPara.length > 0) {
    paragraphs.push({
      text: currentPara.join('\n'),
      startLine: paraStart,
      endLine: baseLineNumber + lines.length - 1,
    })
  }

  return paragraphs
}

/**
 * Get overlap text from the end of previous paragraphs.
 */
function getOverlapText(paragraphs: string[], overlapChars: number): string {
  if (paragraphs.length === 0) return ''

  // Take text from the end until we hit overlap limit
  let overlap = ''
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const para = paragraphs[i]
    if (overlap.length + para.length <= overlapChars) {
      overlap = para + (overlap ? '\n\n' + overlap : '')
    } else {
      // Take partial paragraph if needed
      const remaining = overlapChars - overlap.length
      if (remaining > 50) {
        // Only take partial if meaningful
        const partial = para.slice(-remaining)
        overlap = partial + (overlap ? '\n\n' + overlap : '')
      }
      break
    }
  }

  return overlap
}

/**
 * SHA256 hash of text for deduplication.
 */
function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Hash file content for change detection.
 */
export function hashFileContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
