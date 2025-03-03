# claude-code-figma: An AI-First Developer Tool

<div align="center">
  <img src="./logo.png" alt="Claude Code Figma Logo" width="200"/>
</div>

**Part of the Claude Code ecosystem of AI-integrated tools**

`claude-code-figma` is a command-line tool built from the ground up for AI integration. Unlike traditional developer tools meant for direct use, this CLI is optimized for Claude Code to extract, transform, and implement Figma designs as code that seamlessly integrates with your existing project.

> 🤖 **AI-First Approach**: Commands, outputs, and workflows are designed for optimal Claude Code interpretation, creating a bridge between Figma designs and your codebase.

## Installation

### Global Installation

```bash
npm install -g claude-code-figma
```

### Local Installation

```bash
npm install claude-code-figma
```

## Usage

### Authentication

Before using the tool, you need to authenticate with Figma:

```bash
claude-code-figma auth
```

This will guide you through creating a personal access token on Figma's website and saving it securely.

### Extract Metadata

To extract metadata from a Figma component:

```bash
claude-code-figma extract [figma-url]
```

Example:

```bash
claude-code-figma extract https://www.figma.com/file/abcdef123456/MyDesigns?node-id=123%3A456
```

### Options

- `-o, --output <path>`: Save output to a file instead of printing to console
- `-f, --format <format>`: Output format (summary, json, yaml, bullet). Default: summary
- `-v, --verbose`: Enable verbose logging
- `--optimize`: Optimize output for component mapping (enabled by default)

Example:

```bash
# Using default summary format (recommended)
claude-code-figma extract https://www.figma.com/file/abcdef123456/MyDesigns?node-id=123%3A456

# Save to file
claude-code-figma extract https://www.figma.com/file/abcdef123456/MyDesigns?node-id=123%3A456 --output component-metadata.md

# Using other formats
claude-code-figma extract https://www.figma.com/file/abcdef123456/MyDesigns?node-id=123%3A456 --format json
```

The default summary format creates a detailed blueprint with embedded Figma metadata that helps Claude Code:

1. Identify component types (button, modal, card, etc.)
2. Find matching components in your codebase
3. Map Figma properties to your component props
4. Generate Tailwind CSS classes for styling
5. Identify colors that need to be added to your Tailwind config
6. Provide implementation guidance specific to the component type
7. Preserve design intent while using your project's component system

The optimization process automatically generates Tailwind CSS classes for:
- Layout (flex, grid, padding, margin, etc.)
- Typography (font size, weight, color, etc.)
- Colors (background, text, border colors)
- Borders and rounded corners
- Sizing and spacing
- Shadows and effects

## Integration with Claude Code

### Using the Init Command with Claude Code (Easiest)

The easiest way to set up integration is to:

1. Install this tool in your project:
   ```bash
   npm install --save-dev claude-code-figma
   ```

2. Ask Claude Code to run the init command:
   ```
   Please run claude-code-figma init and follow its instructions to create a CLAUDE.md file
   ```

3. Claude Code will:
   - Run the `init` command
   - Read the instructions
   - Create a customized CLAUDE.md file for your project
   - Adjust it based on your project's structure

### Manual Integration

Alternatively, you can manually add the following to your project's `CLAUDE.md` file:

```markdown
## Figma Integration

This project uses the `claude-code-figma` CLI tool to extract design information from Figma. 

### Converting Figma designs to code

When a Figma link is provided, use the following steps:

1. Extract the Figma metadata:
   ```bash
   claude-code-figma extract <figma-url>
   ```

2. Based on the metadata, implement the component using:
   - The project's existing theme system for colors, typography, and spacing
   - The component structure from the Figma design
   - The naming conventions used in the codebase
   - The framework and styling approaches used in the project
```

## Example Workflow

1. User provides a Figma link to Claude
2. Claude runs `claude-code-figma extract <url>` to get the component blueprint with embedded metadata
3. Claude uses the component mapping hints to find existing components in the project
4. Claude analyzes the optimized metadata and the project's existing code/themes
5. Claude generates a component that matches the design while respecting project conventions and reusing existing components

## The AI-First CLI Paradigm

`claude-code-figma` represents a new approach to developer tooling, where:

1. **Designed for AI Collaboration**: Commands are structured for optimal AI interpretation, not just human readability
2. **Contextually Adaptive**: Outputs adapt to each project's specific conventions and structure
3. **Progressive Discovery**: The tool helps Claude Code understand your project's patterns and preferences over time
4. **Metadata Transformation**: Figma design data is transformed to match your code's structure and style
5. **Natural Language Interface**: Users interact with the tool through Claude Code using natural language

This approach shifts the developer workflow from:

```
Human → CLI → Output → Human interpretation → Code
```

To a more efficient model:

```
Human → Claude Code → CLI → Optimized data → Claude Code → Production-ready code
```

By embracing this AI-first paradigm, `claude-code-figma` dramatically reduces the cognitive load and manual effort required to implement designs, allowing developers to focus on higher-level tasks while maintaining full control over the code quality and style.

## License

ISC