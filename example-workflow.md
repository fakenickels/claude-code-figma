# Example Workflow: From Figma Design to Code

This document walks through a typical workflow using claude-code-figma with Claude Code to implement a design component.

## Setup Phase (One-time per project)

1. **Install the tool in your project:**

   ```bash
   npm install --save-dev claude-code-figma
   ```

2. **Ask Claude Code to set up Figma integration:**

   ```
   User: Please run claude-code-figma init and follow its instructions to create a CLAUDE.md file for this project.
   ```

3. **Claude analyzes your project and creates a CLAUDE.md file:**

   Claude will:
   - Run `claude-code-figma init`
   - Read the instructions
   - Analyze your project structure, component organization, and styling approaches
   - Create a customized CLAUDE.md file tailored to your project's conventions

## Implementation Phase (For each design component)

1. **Share a Figma design URL with Claude:**

   ```
   User: Can you implement this button component from our design system?
   https://www.figma.com/file/abc123/DesignSystem?node-id=42:156
   ```

2. **Claude extracts and analyzes the design metadata:**

   Claude will:
   - Extract the metadata using `claude-code-figma extract <url> --optimize`
   - Analyze the optimized metadata (component type, styling, structure)
   - Look for similar components in your codebase
   - Identify the appropriate styling approach based on your CLAUDE.md

3. **Claude generates and explains the implementation:**

   ```jsx
   // Button.jsx
   import React from 'react';
   import { cn } from '../utils';
   
   const Button = ({ 
     children, 
     variant = 'primary',
     size = 'medium',
     className, 
     ...props 
   }) => {
     return (
       <button
         className={cn(
           "inline-flex items-center justify-center rounded-md font-medium",
           "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
           variant === 'primary' && "bg-blue-600 text-white hover:bg-blue-700",
           variant === 'secondary' && "bg-gray-100 text-gray-900 hover:bg-gray-200",
           size === 'small' && "text-sm px-3 py-1.5",
           size === 'medium' && "text-base px-4 py-2",
           size === 'large' && "text-lg px-5 py-2.5",
           className
         )}
         {...props}
       >
         {children}
       </button>
     );
   };

   export default Button;
   ```

4. **Claude explains design decisions and implementation details:**

   Claude will explain how the implementation:
   - Matches the Figma design's visual style
   - Uses your project's existing conventions (from CLAUDE.md)
   - Supports variants from the design
   - Can be extended for additional use cases

## Customization and Iteration

You can continue to refine the implementation by asking Claude to:

- "Add missing variants from the design"
- "Make this component more accessible"
- "Refactor to use our project's theme tokens"
- "Add tests for this component"

Claude will maintain consistency with both the original design and your project's conventions.

## Benefits of This Approach

- **Design Fidelity**: Accurately implements designs from Figma
- **Code Consistency**: Respects your project's existing patterns and conventions
- **Efficiency**: Dramatically reduces the time from design to implementation
- **Contextual Understanding**: The more you use it, the better Claude understands your project

This AI-first approach transforms the design implementation process from manual translation to a guided, semi-automated workflow that maintains your control while reducing repetitive work.