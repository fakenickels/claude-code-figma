#!/usr/bin/env node

import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import open from 'open';
import inquirer from 'inquirer';
import dotenv from 'dotenv';
import ora from 'ora';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import FigmaClient from './figma-client.js';

// Load environment variables
dotenv.config();

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.figma-to-code');
const TOKEN_PATH = path.join(CONFIG_DIR, 'auth.json');

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Function to get the stored token or prompt for authentication
async function getAuthToken() {
  // Check if token exists
  if (fs.existsSync(TOKEN_PATH)) {
    try {
      const tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      return tokenData.token;
    } catch (error) {
      console.error('Error reading auth token:', error.message);
    }
  }

  // If no token, guide the user through authentication
  console.log('No Figma authentication token found.');
  console.log('Please follow these steps to authenticate:');
  console.log('1. Go to https://www.figma.com/developers/api');
  console.log('2. Log in and create a personal access token');
  console.log('3. Copy the token and paste it here');
  console.log('\nNote: Make sure you are using a token from the account that has access to the Figma file.');
  console.log('If you need to change accounts, you can reset your token anytime with: claude-code-figma auth --reset');

  const { openBrowser } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'openBrowser',
      message: 'Open the Figma API page in your browser?',
      default: true
    }
  ]);

  if (openBrowser) {
    await open('https://www.figma.com/developers/api');
  }

  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: 'Paste your Figma personal access token:',
      validate: input => input.trim() !== '' || 'Token is required'
    }
  ]);

  // Save the token
  fs.writeFileSync(TOKEN_PATH, JSON.stringify({ token }, null, 2));
  console.log('Authentication successful. Token saved.');
  
  return token;
}

// Parse Figma URL to extract file key and node ID
function parseFigmaUrl(url) {
  try {
    // Parse the URL
    const parsedUrl = new URL(url);
    
    // Get the pathname to extract file/design key
    const pathname = parsedUrl.pathname;
    
    // Extract node-id from search params
    const searchParams = new URLSearchParams(parsedUrl.search);
    let nodeId = searchParams.get('node-id');
    
    // Check if we need to convert hyphen to colon in node ID
    // We'll accept both formats now based on the Figma URL
    if (nodeId && nodeId.includes('-')) {
      // Keep the original format as given in the URL
      // The FigmaClient.findNodeById function will handle the search
    }
    
    // Determine if it's a file or design URL and extract the key
    let fileKey = null;
    
    // Split the pathname into segments
    const segments = pathname.split('/').filter(segment => segment.length > 0);
    
    // Handle different Figma URL formats
    if (segments.length >= 2) {
      // Format: /file/{key}/... or /design/{key}/...
      if (segments[0] === 'file' || segments[0] === 'design') {
        fileKey = segments[1];
      }
    }
    
    if (!fileKey) {
      throw new Error('Could not extract file key from URL. Supported formats: figma.com/file/KEY or figma.com/design/KEY');
    }
    
    return {
      fileKey,
      nodeId
    };
  } catch (error) {
    if (error.message.includes('Invalid URL')) {
      throw new Error('Invalid Figma URL. Please provide a valid URL from Figma.');
    }
    throw error;
  }
}

// Function to fetch and process node metadata from Figma
async function fetchNodeMetadata(url, verbose = false) {
  const spinner = ora('Authenticating with Figma...').start();
  
  // Helper for conditional logging based on verbose flag
  const log = (...args) => {
    if (verbose) {
      console.log(...args);
    }
  };
  
  try {
    const token = await getAuthToken();
    const figma = new FigmaClient(token, verbose);
    
    spinner.text = 'Parsing Figma URL...';
    log('Parsing URL:', url);
    const { fileKey, nodeId } = parseFigmaUrl(url);
    log('Extracted fileKey:', fileKey);
    log('Extracted nodeId:', nodeId);
    
    // If we have a specific node ID, use the more efficient nodes endpoint
    if (nodeId) {
      spinner.text = `Fetching node data for ${nodeId}...`;
      try {
        const nodesData = await figma.fileNodes(fileKey, [nodeId]);
        log('Nodes data retrieved successfully');
        
        // Debug the nodes response only in verbose mode
        if (verbose) {
          log('API response:', JSON.stringify(nodesData, null, 2));
        }
        
        // Check if the node was found
        if (nodesData.nodes && nodesData.nodes[nodeId]) {
          spinner.succeed('Fetched node metadata successfully');
          
          // Extract the node document from the response
          const nodeDocument = nodesData.nodes[nodeId].document;
          
          // Process the node properties using our enhanced extraction
          const processedNode = figma.extractNodeProperties(nodeDocument);
          
          return processedNode;
        } else {
          // If we can't find the exact nodeId, it may be in a different format
          // Try to handle both hyphen and colon formats
          const alternateNodeId = nodeId.includes('-') 
            ? nodeId.replace('-', ':') 
            : nodeId.replace(':', '-');
          
          spinner.text = `Trying alternate node ID format: ${alternateNodeId}...`;
          
          try {
            const alternateData = await figma.fileNodes(fileKey, [alternateNodeId]);
            
            if (alternateData.nodes && alternateData.nodes[alternateNodeId]) {
              spinner.succeed(`Fetched node metadata using alternate format: ${alternateNodeId}`);
              
              // Extract the node document from the response
              const nodeDocument = alternateData.nodes[alternateNodeId].document;
              
              // Process the node properties using our enhanced extraction
              const processedNode = figma.extractNodeProperties(nodeDocument);
              
              return processedNode;
            }
          } catch (alternateError) {
            // Continue with original error handling if alternate ID also fails
          }
          
          spinner.fail(`Node with ID ${nodeId} not found in response`);
          
          // If we have nodes but the specific one wasn't found, show available nodes and exit
          if (nodesData.nodes && Object.keys(nodesData.nodes).length > 0) {
            console.error('The node ID format might be different. Available nodes:');
            console.error(Object.keys(nodesData.nodes).join(', '));
            console.error(`\nPlease use one of these node IDs in your URL.`);
          } else {
            console.error('No nodes were found in the response.');
          }
          
          // Exit the program - this is a fatal error
          process.exit(1);
        }
      } catch (error) {
        // If this fails and it's a design URL, we might need to try alternative methods
        if (error.message.includes('404') && url.includes('/design/')) {
          spinner.fail('Could not access this Figma design node');
          console.log('\nThe provided design URL format is not directly supported by the Figma API.');
          console.log('Please try with a file URL from the same design (click "Share" and copy the link)');
          console.log('The URL should start with: https://www.figma.com/file/');
          throw new Error('Could not access Figma design. Please use a file URL instead.');
        }
        throw error;
      }
    }
    
    // If no node ID is specified, fetch the entire file
    spinner.text = `Fetching file data for ${fileKey}...`;
    console.log('Warning: No node ID specified. Fetching entire file, which may be slow for large files.');
    console.log('For better performance, specify a node ID in the URL using ?node-id=X:Y');
    
    try {
      const fileData = await figma.file(fileKey);
      spinner.succeed('Fetched document metadata successfully');
      
      // Process the document properties using our enhanced extraction
      const processedDocument = figma.extractNodeProperties(fileData.document);
      
      return processedDocument;
    } catch (error) {
      if (error.message.includes('404') && url.includes('/design/')) {
        spinner.fail('Could not access this Figma design');
        console.log('\nThe provided design URL format is not directly supported by the Figma API.');
        console.log('Please try with a file URL from the same design (click "Share" and copy the link)');
        console.log('The URL should start with: https://www.figma.com/file/');
        throw new Error('Could not access Figma design. Please use a file URL instead.');
      }
      throw error;
    }
  } catch (error) {
    spinner.fail(`Error: ${error.message}`);
    throw error;
  }
}

// Main program
program
  .name('claude-code-figma')
  .description('AI-first CLI to help Claude Code extract and implement Figma designs')
  .version('1.1.0')
  .addHelpText('after', `
Examples:
  $ claude-code-figma extract https://www.figma.com/file/abcdef123456/MyDesign?node-id=1:2
  $ claude-code-figma extract https://www.figma.com/file/abcdef123456/MyDesign?node-id=1:2 --format json
  $ claude-code-figma extract https://www.figma.com/file/abcdef123456/MyDesign?node-id=1:2 --format yaml
  $ claude-code-figma extract https://www.figma.com/file/abcdef123456/MyDesign?node-id=1:2 --format ai-prompt

Output Formats:
  ai-prompt - Detailed design description optimized for AI implementation (default)
             * Structured hierarchical description of design elements
             * Complete styling information with accurate measurements
             * Component hierarchy with nested elements
             * Layout and typography information
             * Optimized for AI-assisted implementation in React with Tailwind CSS
  json     - Standard JSON format with extracted design properties
  yaml     - YAML format (more compact than JSON)
  summary  - Legacy format with component blueprint and embedded information
             * Includes descriptive HTML structure with Figma metadata
             * Provides styling information and component hierarchy
             * Use ai-prompt format for better results with Claude

Claude Code Integration:
  Run 'claude-code-figma init' with Claude Code to create a customized CLAUDE.md file
`);

// Add a verify-url command to check if a URL is valid for the Figma API
program
  .command('verify-url <url>')
  .description('Verify if a Figma URL is supported by the API')
  .action(async (url) => {
    try {
      console.log('Analyzing URL:', url);
      
      // Parse the URL
      const { fileKey, nodeId } = parseFigmaUrl(url);
      console.log('Extracted:');
      console.log(`- File Key: ${fileKey}`);
      console.log(`- Node ID: ${nodeId || 'None'}`);
      
      // Test if the file exists by making a simple API call
      console.log('\nChecking if file exists in Figma API...');
      const token = await getAuthToken();
      
      const spinner = ora('Making API request...').start();
      
      try {
        const response = await fetch(`https://api.figma.com/v1/files/${fileKey}/nodes?ids=${nodeId || '0:1'}`, {
          headers: {
            'X-Figma-Token': token
          }
        });
        
        if (response.ok) {
          spinner.succeed('URL is valid and accessible!');
          console.log('This URL should work with the extract command.');
        } else {
          spinner.fail('URL is not accessible via the Figma API.');
          console.log(`API returned status: ${response.status} ${response.statusText}`);
          
          if (url.includes('/design/')) {
            console.log('\nThis appears to be a design URL, which may not be supported by the Figma API.');
            console.log('Try using a URL in this format instead:');
            console.log('https://www.figma.com/file/KEY/name?node-id=X-Y');
          }
        }
      } catch (error) {
        spinner.fail('Error checking URL');
        console.error(error.message);
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// Helper functions to format Figma data for different output formats
function formatAsAIPrompt(figmaNode, figmaClient) {
  if (!figmaNode) return '';
  
  return figmaClient.generateAIPrompt(figmaNode);
}

// Helper function to convert data to bullet points format
function formatAsBulletPoints(data, indent = 0) {
  if (data === null || data === undefined) return '';
  
  let result = '';
  const indentStr = '  '.repeat(indent);
  
  if (Array.isArray(data)) {
    data.forEach((item, index) => {
      if (typeof item === 'object' && item !== null) {
        result += `${indentStr}- Item ${index + 1}:\n${formatAsBulletPoints(item, indent + 1)}`;
      } else {
        result += `${indentStr}- ${item}\n`;
      }
    });
  } else if (typeof data === 'object' && data !== null) {
    const entries = Object.entries(data);
    entries.forEach(([key, value]) => {
      if (value === null || value === undefined) {
        result += `${indentStr}- ${key}: null\n`;
      } else if (Array.isArray(value) && value.length === 0) {
        result += `${indentStr}- ${key}: []\n`;
      } else if (typeof value === 'object' && Object.keys(value).length === 0) {
        result += `${indentStr}- ${key}: {}\n`;
      } else if (typeof value === 'object') {
        result += `${indentStr}- ${key}:\n${formatAsBulletPoints(value, indent + 1)}`;
      } else {
        result += `${indentStr}- ${key}: ${value}\n`;
      }
    });
  } else {
    result += `${indentStr}${data}\n`;
  }
  
  return result;
}

// Helper to create a legacy summary of the optimized data
function createComponentSummary(data) {
  if (!data) return '';
  
  let summary = '';
  
  // Component basics
  summary += `# ${data.name} (${data.type})\n\n`;
  
  // Descriptive Component Structure with embedded information
  summary += `**Component Structure (Pseudo-HTML with Info):**\n\`\`\`html\n`;
  summary += `<!-- Main Component: ${data.name} (${data.type}) -->\n`;
  summary += `<div data-component-id="${data.id}">\n`;
  
  // Add descriptive children structure with embedded information
  if (data.children && data.children.length > 0) {
    summary += generateDescriptiveComponentStructure(data.children, 2);
  }
  
  summary += `</div>\n\`\`\`\n\n`;
  
  // Component Properties
  summary += `**Component Properties:**\n`;
  
  if (data.size) {
    summary += `- **Size**: ${data.size.width}px × ${data.size.height}px\n`;
  }
  
  if (data.backgroundColor) {
    summary += `- **Background**: ${data.backgroundColor}\n`;
  }
  
  if (data.cornerRadius) {
    summary += `- **Border Radius**: ${data.cornerRadius}px\n`;
  }
  
  if (data.fills && data.fills.length > 0) {
    summary += `- **Fills**: ${data.fills.map(fill => 
      fill.type === 'SOLID' ? fill.color : `${fill.type} gradient`).join(', ')}\n`;
  }
  
  if (data.strokes && data.strokes.length > 0) {
    summary += `- **Border**: ${data.strokeWeight}px ${data.strokes[0].color}\n`;
  }
  
  if (data.effects && data.effects.length > 0) {
    summary += `- **Effects**: ${data.effects.map(effect => effect.type).join(', ')}\n`;
  }
  
  // Layout properties
  if (data.layout) {
    summary += `- **Layout**: ${data.layout.mode === 'HORIZONTAL' ? 'Row' : 'Column'}\n`;
    
    if (data.layout.spacing) {
      summary += `  - **Gap**: ${data.layout.spacing}px\n`;
    }
    
    if (data.layout.padding) {
      const padding = data.layout.padding;
      summary += `  - **Padding**: `;
      
      if (Object.values(padding).every(val => val === Object.values(padding)[0])) {
        summary += `${Object.values(padding)[0]}px all sides\n`;
      } else {
        const paddingStr = [
          padding.top || 0,
          padding.right || 0,
          padding.bottom || 0,
          padding.left || 0
        ].join('px ') + 'px';
        summary += `${paddingStr} (top, right, bottom, left)\n`;
      }
    }
  }
  
  // Enhanced Component Tree visualization
  if (data.children && data.children.length > 0) {
    summary += `\n**Component Tree:**\n\`\`\`\n`;
    summary += generateComponentTree(data);
    summary += `\`\`\`\n\n`;
  }
  
  // Implementation Considerations
  summary += `\n**Implementation Tips:**\n`;
  summary += `- Consider using Flexbox or Grid for layout structure\n`;
  summary += `- Use Tailwind CSS for styling:\n`;
  
  if (data.size) {
    summary += `  - \`w-[${data.size.width}px] h-[${data.size.height}px]\` for dimensions\n`;
  }
  
  if (data.backgroundColor) {
    summary += `  - \`bg-[${data.backgroundColor}]\` for background\n`;
  }
  
  if (data.cornerRadius) {
    summary += `  - \`rounded-[${data.cornerRadius}px]\` for border radius\n`;
  }
  
  if (data.layout && data.layout.mode) {
    summary += `  - \`${data.layout.mode === 'HORIZONTAL' ? 'flex flex-row' : 'flex flex-col'}\` for layout\n`;
    
    if (data.layout.spacing) {
      summary += `  - \`gap-[${data.layout.spacing}px]\` for spacing\n`;
    }
  }
  
  return summary;
}

// Function to display the full component tree in a visual format
function generateComponentTree(component) {
  let result = ''; 
  
  // Add root component
  result += `${component.name} (${component.type})\n`;
  
  // Add all children recursively
  if (component.children && component.children.length > 0) {
    result += generateComponentTreeChildren(component.children, 1);
  }
  
  return result;
}

// Helper for recursive tree generation
function generateComponentTreeChildren(children, level) {
  if (!children || !Array.isArray(children)) return '';
  
  let result = '';
  const indent = '│  '.repeat(level);
  const lastIndex = children.length - 1;
  
  children.forEach((child, index) => {
    // Determine if this is the last child at this level
    const isLast = index === lastIndex;
    const prefix = isLast ? '└─ ' : '├─ ';
    const childLine = `${indent}${prefix}${child.name} (${child.type})`;
    
    result += childLine + '\n';
    
    // Add children of this node recursively with adjusted indentation
    if (child.children && child.children.length > 0) {
      // If this is the last item, use space in the indentation for its children
      // Otherwise use the vertical bar to show the continuation
      const nextIndent = isLast ? level : level + 1;
      result += generateComponentTreeChildren(child.children, nextIndent);
    }
  });
  
  return result;
}

// Generate descriptive HTML-like structure with embedded Figma information
function generateDescriptiveComponentStructure(children, indentLevel) {
  if (!children || children.length === 0) return '';
  
  const indent = ' '.repeat(indentLevel);
  let structure = '';
  
  children.forEach(child => {
    // Add common attributes to all elements
    const commonAttrs = [
      `data-figma-id="${child.id || ''}"`,
      `data-type="${child.type || ''}"`,
      `data-name="${child.name || ''}"`
    ];
    
    if (child.type === 'TEXT') {
      // For text nodes, include text content and styling
      structure += `${indent}<!-- Text: ${child.name} -->\n`;
      structure += `${indent}<p ${commonAttrs.join(' ')}`;
      
      // Add style information if available
      if (child.textStyle) {
        const { fontFamily, fontSize, fontWeight } = child.textStyle;
        structure += ` data-font="${fontFamily || 'default'}" data-size="${fontSize || ''}px" data-weight="${fontWeight || ''}"`;
      }
      
      structure += `>\n`;
      structure += `${indent}  ${child.textContent || '[No Text Content]'}\n`;
      structure += `${indent}</p>\n`;
    } 
    else if (child.type === 'INSTANCE') {
      // For component instances, include component info
      structure += `${indent}<!-- Instance: ${child.name} -->\n`;
      structure += `${indent}<component`;
      
      // Add component ID
      if (child.componentId) {
        structure += ` data-component-id="${child.componentId}"`;
      }
      
      structure += ` ${commonAttrs.join(' ')}`;
      
      // Add component properties
      if (child.componentProperties) {
        structure += ` ${generateComponentAttributes(child.componentProperties)}`;
      }
      
      // Check if it has children
      if (child.children && child.children.length > 0) {
        structure += `>\n`;
        structure += generateDescriptiveComponentStructure(child.children, indentLevel + 2);
        structure += `${indent}</component>\n`;
      } else {
        structure += ` />\n`;
      }
    } 
    else {
      // For container nodes, include styling and layout
      structure += `${indent}<!-- Container: ${child.name} -->\n`;
      
      // Add layout information if available
      let layoutInfo = '';
      if (child.layout) {
        const { mode, spacing, padding } = child.layout;
        layoutInfo = ` data-layout="${mode === 'HORIZONTAL' ? 'row' : 'column'}" data-gap="${spacing || 0}"`;
        
        if (padding && Object.keys(padding).length > 0) {
          layoutInfo += ` data-padding="${Object.entries(padding).map(([k, v]) => `${k}:${v}`).join(',')}"`;
        }
      }
      
      structure += `${indent}<div ${commonAttrs.join(' ')}${layoutInfo}>\n`;
      
      // Recursively add children
      if (child.children && child.children.length > 0) {
        structure += generateDescriptiveComponentStructure(child.children, indentLevel + 2);
      }
      
      structure += `${indent}</div>\n`;
    }
  });
  
  return structure;
}

// Helper to generate component attributes from componentProperties
function generateComponentAttributes(componentProperties) {
  if (!componentProperties) return '';
  
  return Object.entries(componentProperties)
    .map(([key, value]) => {
      const propName = camelCase(key);
      
      if (value.type === 'BOOLEAN') {
        return value.value ? `data-prop-${propName}="true"` : '';
      } else if (value.type === 'TEXT') {
        return `data-prop-${propName}="${value.value}"`;
      } else if (value.type === 'VARIANT') {
        return `data-variant-${propName}="${value.value}"`;
      } else if (value.type === 'INSTANCE_SWAP') {
        return `data-swap-${propName}="${value.value}"`;
      }
      
      return '';
    })
    .filter(attr => attr !== '')
    .join(' ');
}

// Helper to convert string to camelCase
function camelCase(str) {
  if (!str) return '';
  return str
    .replace(/[^\w\s]/g, '')
    .split(/[-\s]/)
    .map((word, i) => i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

program
  .command('extract <url>')
  .description('Extract metadata from a Figma URL')
  .option('-o, --output <path>', 'Output file path (defaults to stdout)')
  .option('-f, --format <format>', 'Output format (ai-prompt, json, yaml, summary)', 'ai-prompt')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (url, options) => {
    try {
      const spinner = ora('Extracting metadata from Figma...').start();
      const metadata = await fetchNodeMetadata(url, options.verbose);
      spinner.succeed('Metadata extracted successfully');
      
      // Initialize Figma client needed for AI prompt generation
      const token = await getAuthToken();
      const figma = new FigmaClient(token, options.verbose);
      
      // Format the output based on requested format
      let output;
      if (options.format === 'json') {
        output = JSON.stringify(metadata, null, 2);
      } else if (options.format === 'yaml') {
        // Simple JSON to YAML conversion
        const yaml = await import('js-yaml');
        output = yaml.default.dump(metadata);
      } else if (options.format === 'bullet') {
        // Convert to bullet points for more readable output
        output = formatAsBulletPoints(metadata);
      } else if (options.format === 'ai-prompt') {
        // Generate the AI-optimized prompt
        spinner.text = 'Generating AI-optimized prompt...';
        output = formatAsAIPrompt(metadata, figma);
        spinner.succeed('AI prompt generated');
      } else if (options.format === 'summary') {
        // Create a readable legacy summary
        output = createComponentSummary(metadata);
      } else {
        throw new Error(`Unsupported format: ${options.format}`);
      }
      
      // Output the result
      if (options.output) {
        fs.writeFileSync(options.output, output);
        console.log(`Metadata saved to ${options.output}`);
      } else {
        // Output directly to stdout
        console.log(output);
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('auth')
  .description('Manage Figma authentication')
  .option('--reset', 'Reset authentication and prompt for a new token')
  .action(async (options) => {
    try {
      // Check if reset option is provided
      if (options.reset) {
        if (fs.existsSync(TOKEN_PATH)) {
          // Remove the existing token file
          fs.unlinkSync(TOKEN_PATH);
          console.log('Authentication token has been reset.');
        } else {
          console.log('No authentication token found to reset.');
        }
        
        // Prompt for a new token
        const token = await getAuthToken();
        console.log('New authentication token saved successfully.');
        
        // Verify the new token
        console.log('Verifying new token...');
        const response = await fetch('https://api.figma.com/v1/me', {
          headers: {
            'X-Figma-Token': token
          }
        });
        
        if (!response.ok) {
          console.error('API verification failed. Your token may be invalid or expired.');
          process.exit(1);
        }
        
        const userData = await response.json();
        console.log('Authentication verified successfully!');
        console.log('User info:');
        console.log(`- Email: ${userData.email}`);
        console.log(`- Handle: ${userData.handle}`);
        console.log(`- ID: ${userData.id}`);
      } else {
        // Standard auth verification
        const token = await getAuthToken();
        
        // If we get here, we have a token. Let's verify it by checking user info
        console.log('Verifying token by fetching user info...');
        const response = await fetch('https://api.figma.com/v1/me', {
          headers: {
            'X-Figma-Token': token
          }
        });
        
        if (!response.ok) {
          console.error('API verification failed. Your token may be invalid or expired.');
          console.error('Please try re-authenticating with: claude-code-figma auth --reset');
          process.exit(1);
        }
        
        const userData = await response.json();
        console.log('Authentication verified successfully!');
        console.log('User info:');
        console.log(`- Email: ${userData.email}`);
        console.log(`- Handle: ${userData.handle}`);
        console.log(`- ID: ${userData.id}`);
      }
    } catch (error) {
      console.error(`Authentication error: ${error.message}`);
      process.exit(1);
    }
  });

// Command to generate instructions for Claude Code to create a CLAUDE.md file
program
  .command('init')
  .description('Output instructions for Claude Code to create a CLAUDE.md template file')
  .action(async () => {
    try {
      // Get current directory where figma-to-code is installed
      const figmaToCodeDir = path.dirname(fileURLToPath(import.meta.url));
      const templatePath = path.join(figmaToCodeDir, 'CLAUDE.md.template');
      
      // Read the template
      let templateContent;
      try {
        templateContent = fs.readFileSync(templatePath, 'utf8');
      } catch (error) {
        console.error(`Error reading template: ${error.message}`);
        process.exit(1);
      }
      
      // Output instructions for Claude Code
      console.log(`\n=== INSTRUCTIONS FOR CLAUDE CODE ===\n`);
      console.log(`Hello Claude! I'm claude-code-figma, an AI-first CLI tool designed specifically for you.`);
      console.log(`\nMy motto: "Design once, implement everywhere - bridging Figma and code through AI collaboration"`);
      console.log(`\nUnlike traditional CLIs meant for direct human use, I'm designed with your capabilities in mind.`);
      console.log(`My outputs are structured for optimal AI processing, and I transform design data into context-aware code suggestions.`);
      console.log(`\nI'll help you create or update a CLAUDE.md file in this project with the recommended claude-code-figma configuration.`);
      console.log(`\nPlease create a new file named 'CLAUDE.md' in the project root (or update the existing one) with the following content:\n`);
      console.log(`\`\`\`markdown`);
      console.log(templateContent);
      console.log(`\`\`\`\n`);
      console.log(`Customize this template for the current project by:`);
      console.log(`1. Adding the project name to the title`);
      console.log(`2. Updating the component directory paths to match this project's structure`);
      console.log(`3. Updating the color system section to reference the project's theming approach`);
      console.log(`4. Updating the typography section to match the project's font system`);
      console.log(`5. Updating the naming conventions section to reflect this project's conventions`);
      console.log(`\nYou can scan the project files to identify these conventions automatically.`);
      console.log(`\nIf there's already a CLAUDE.md file in this project:`);
      console.log(`1. Add the Figma Integration section to it, preserving any existing content`);
      console.log(`2. Adapt the section to match the project's existing conventions`);
      console.log(`3. Make sure the examples match the actual project structure`);
      console.log(`\nAfter creating or updating this file, you'll be able to read it automatically in future sessions to help convert Figma designs to code.`);
      console.log(`\n=== END INSTRUCTIONS ===\n`);
      
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program.parse(process.argv);