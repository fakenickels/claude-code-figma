# claude-code-figma: AI-First CLI Tool

## Project Vision

`claude-code-figma` is a new class of developer tool built specifically for AI assistance. Unlike traditional CLIs designed for direct developer use, this tool is optimized for Claude Code integration, enabling seamless workflow between design and implementation.

### Key Principles

- **AI-First Experience**: Commands and outputs are formatted for optimal AI interpretation
- **Bridging Design & Code**: Extracts and transforms Figma designs into structured data that Claude can understand
- **Contextual Integration**: The `init` command helps Claude create contextual guidance specific to each project
- **Adaptive Output**: Metadata is transformed to respect existing codebases and conventions

## Tool Usage

This CLI is primarily meant to be used via Claude Code in projects that need Figma design implementation:

1. A user installs the tool in their project
2. The user asks Claude to run `claude-code-figma init` 
3. Claude creates a customized CLAUDE.md for that specific project
4. When the user shares Figma URLs, Claude uses the tool to extract and optimize metadata
5. Claude implements components that match both the design and the project's conventions

## Project Structure

- `figma-client.js` - Custom Figma API client
- `index.js` - CLI entry point with commands optimized for Claude interaction
- `CLAUDE.md.template` - Template for project-specific guidance
- Additional source files should go in src/

## Development Guidelines

When extending this tool:

1. Design for AI interaction first, human usage second
2. Format command outputs for easy AI parsing
3. Provide clear, structured metadata with hints and patterns
4. Include context to help Claude match designs to existing codebases
5. Support progressive discovery of project conventions

This approach creates a new paradigm where developer tools are co-designed with AI assistants to maximize productivity.