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
  console.log('If you need to change accounts, you can reset your token anytime with: figma-to-code auth --reset');

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
    
    // Convert hyphen to colon in node ID if needed (Figma API expects colon format)
    if (nodeId && nodeId.includes('-')) {
      nodeId = nodeId.replace('-', ':');
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

// Function to fetch node metadata from Figma
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
          return nodesData.nodes[nodeId];
        } else {
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
    
    // If no node ID is specified, fetch the entire file (with a warning about performance)
    spinner.text = `Fetching file data for ${fileKey}...`;
    // Always show these warnings regardless of verbose mode as they're important
    console.log('Warning: No node ID specified. Fetching entire file, which may be slow for large files.');
    console.log('For better performance, specify a node ID in the URL using ?node-id=X:Y');
    
    try {
      const fileData = await figma.file(fileKey);
      spinner.succeed('Fetched document metadata successfully');
      return fileData;
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
  .version('1.0.0')
  .addHelpText('after', `
Examples:
  $ claude-code-figma extract https://www.figma.com/file/abcdef123456/MyDesign?node-id=1:2 --optimize
  $ claude-code-figma init
  $ claude-code-figma auth --reset

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

// Helper functions for optimizing Figma data for component mapping
function optimizeFigmaData(figmaNode) {
  if (!figmaNode || !figmaNode.document) {
    return figmaNode; // Return as-is if not in expected format
  }

  // Extract the document node
  const document = figmaNode.document;
  
  // Create the optimized data structure
  const optimizedData = {
    originalData: figmaNode, // Keep the original data for reference
    component: {
      name: document.name,
      type: document.type,
      id: document.id,
      componentType: guessComponentType(document),
      componentHints: generateComponentHints(document),
      properties: extractProperties(document),
      tailwindClasses: generateTailwindClasses(document),
      children: processChildren(document.children),
      styles: extractStyles(document, figmaNode.styles),
      variants: extractVariants(document),
      interactionPatterns: extractInteractions(document),
      implementationGuide: generateImplementationGuide(document)
    }
  };
  
  return optimizedData;
}

// Helper functions for optimization process
function guessComponentType(node) {
  // Try to determine what kind of component this is (button, modal, card, etc.)
  // based on node properties, name, and children
  
  const nameLower = node.name?.toLowerCase() || '';
  
  if (nameLower.includes('button') || 
      (node.type === 'INSTANCE' && nameLower.includes('btn'))) {
    return 'button';
  }
  
  if (nameLower.includes('modal') || 
      nameLower.includes('dialog') || 
      (node.children && node.children.some(c => c.name?.toLowerCase().includes('modal')))) {
    return 'modal';
  }
  
  if (nameLower.includes('card') || 
      (node.cornerRadius && node.cornerRadius > 0 && node.children)) {
    return 'card';
  }
  
  if (nameLower.includes('input') || 
      nameLower.includes('field') || 
      nameLower.includes('form')) {
    return 'input';
  }
  
  if (nameLower.includes('alert') || 
      nameLower.includes('notification') ||
      nameLower.includes('toast')) {
    return 'alert';
  }
  
  if (nameLower.includes('cancel')) {
    return 'confirmation-dialog';
  }
  
  return 'unknown';
}

function generateComponentHints(node) {
  // Generate search hints for finding matching components in the host project
  // Based on node name, type, and other characteristics
  
  const hints = [];
  
  // Add name-based hints
  if (node.name) {
    hints.push(node.name);
    
    // Add common component naming patterns
    const nameLower = node.name.toLowerCase();
    
    if (nameLower.includes('cancel')) {
      hints.push('Cancel', 'CancelDialog', 'Confirmation', 'ConfirmationDialog');
    }
  }
  
  // Add type-based hints
  if (node.type === 'INSTANCE') {
    // If it's an instance, we can use the component name as a hint
    hints.push(`Component: ${node.name}`);
  }
  
  // Add style-based hints
  if (node.fills && node.fills.length > 0) {
    const colors = node.fills
      .filter(fill => fill.type === 'SOLID')
      .map(fill => {
        const color = fill.color;
        return `rgb(${Math.round(color.r*255)}, ${Math.round(color.g*255)}, ${Math.round(color.b*255)})`;
      });
    
    if (colors.length > 0) {
      hints.push(`Colors: ${colors.join(', ')}`);
    }
  }
  
  return hints;
}

function extractProperties(node) {
  // Extract important properties that would be useful for component matching
  const props = {};
  
  // Extract basic properties
  if (node.backgroundColor) {
    props.backgroundColor = formatColor(node.backgroundColor);
  }
  
  if (node.cornerRadius) {
    props.borderRadius = node.cornerRadius;
  }
  
  if (node.strokes && node.strokes.length > 0) {
    props.border = {
      width: node.strokeWeight || 1,
      style: 'solid', // Default to solid
      color: formatColor(node.strokes[0].color)
    };
  }
  
  // Extract layout properties
  if (node.layoutMode) {
    props.layout = {
      direction: node.layoutMode === 'HORIZONTAL' ? 'row' : 'column',
      gap: node.itemSpacing || 0,
      padding: extractPadding(node)
    };
  }
  
  return props;
}

function formatColor(color) {
  if (!color) return null;
  
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = color.a !== undefined ? color.a : 1;
  
  if (a === 1) {
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
}

function extractPadding(node) {
  const padding = {};
  
  if (node.paddingLeft !== undefined) padding.left = node.paddingLeft;
  if (node.paddingRight !== undefined) padding.right = node.paddingRight;
  if (node.paddingTop !== undefined) padding.top = node.paddingTop;
  if (node.paddingBottom !== undefined) padding.bottom = node.paddingBottom;
  
  return padding;
}

function processChildren(children) {
  if (!children || !Array.isArray(children)) return [];
  
  return children.map(child => {
    const result = {
      id: child.id,
      name: child.name,
      type: child.type,
      componentType: guessComponentType(child),
      properties: extractProperties(child),
      tailwindClasses: generateTailwindClasses(child)
    };
    
    // Handle text nodes specially
    if (child.type === 'TEXT') {
      result.text = child.characters;
      result.textStyle = extractTextStyle(child);
      result.tailwindTextClasses = generateTailwindTextClasses(child);
    }
    
    // Process nested children
    if (child.children && child.children.length > 0) {
      result.children = processChildren(child.children);
    }
    
    // Handle component instances
    if (child.type === 'INSTANCE') {
      result.componentId = child.componentId;
      if (child.componentProperties) {
        result.componentProperties = child.componentProperties;
      }
    }
    
    return result;
  });
}

function extractTextStyle(textNode) {
  if (!textNode.style) return {};
  
  return {
    fontFamily: textNode.style.fontFamily,
    fontSize: textNode.style.fontSize,
    fontWeight: textNode.style.fontWeight,
    lineHeight: textNode.style.lineHeightPx,
    letterSpacing: textNode.style.letterSpacing,
    textAlign: textNode.style.textAlignHorizontal?.toLowerCase(),
    color: textNode.fills && textNode.fills.length > 0 ? formatColor(textNode.fills[0].color) : null
  };
}

function extractStyles(node, projectStyles) {
  // Extract style references that could map to design tokens or theme variables
  const styles = {};
  
  // Extract style references from the node
  if (node.styles) {
    Object.entries(node.styles).forEach(([key, value]) => {
      styles[key] = value;
    });
  }
  
  // Extract bound variables from the node
  if (node.boundVariables) {
    styles.variables = node.boundVariables;
  }
  
  // Add any project styles that are referenced
  if (projectStyles) {
    styles.projectStyles = projectStyles;
  }
  
  return styles;
}

function extractVariants(node) {
  // Extract variant information if this is a component instance
  if (node.type !== 'INSTANCE' || !node.componentProperties) {
    return {};
  }
  
  const variants = {};
  
  // Process component properties to extract variant info
  Object.entries(node.componentProperties).forEach(([key, value]) => {
    if (value.type === 'VARIANT') {
      variants[key] = value.value;
    }
  });
  
  return variants;
}

function extractInteractions(node) {
  if (!node.interactions || node.interactions.length === 0) {
    return [];
  }
  
  return node.interactions.map(interaction => ({
    trigger: interaction.trigger?.type,
    action: interaction.actions?.[0]?.type,
    target: interaction.actions?.[0]?.destinationId
  }));
}

// Tailwind CSS specific helper functions
function generateTailwindClasses(node) {
  if (!node) return [];
  
  const classes = [];
  
  // Extract layout classes
  if (node.layoutMode === 'HORIZONTAL') {
    classes.push('flex', 'flex-row');
  } else if (node.layoutMode === 'VERTICAL') {
    classes.push('flex', 'flex-col');
  }
  
  // Extract spacing classes
  if (node.itemSpacing) {
    const gap = pxToTailwindSpacing(node.itemSpacing);
    if (gap) classes.push(`gap-${gap}`);
  }
  
  // Extract padding classes
  const padding = extractPaddingClasses(node);
  if (padding.length > 0) {
    classes.push(...padding);
  }
  
  // Extract background color
  if (node.backgroundColor) {
    const bgClass = colorToTailwindClass(node.backgroundColor, 'bg');
    if (bgClass) classes.push(bgClass);
  }
  
  // Extract border radius
  if (node.cornerRadius) {
    const rounded = pxToTailwindBorderRadius(node.cornerRadius);
    if (rounded) classes.push(`rounded-${rounded}`);
  }
  
  // Extract border
  if (node.strokes && node.strokes.length > 0) {
    const borderClass = colorToTailwindClass(node.strokes[0].color, 'border');
    if (borderClass) classes.push(borderClass);
    
    if (node.strokeWeight) {
      const borderWidth = pxToTailwindBorderWidth(node.strokeWeight);
      if (borderWidth) classes.push(`border-${borderWidth}`);
    } else {
      classes.push('border');
    }
  }
  
  // Extract width and height
  if (node.absoluteBoundingBox) {
    const { width, height } = node.absoluteBoundingBox;
    
    if (width) {
      const widthClass = pxToTailwindSize(width, 'w');
      if (widthClass) classes.push(widthClass);
    }
    
    if (height) {
      const heightClass = pxToTailwindSize(height, 'h');
      if (heightClass) classes.push(heightClass);
    }
  }
  
  // Extract shadow
  if (node.effects && node.effects.length > 0) {
    const shadowClasses = extractShadowClasses(node.effects);
    if (shadowClasses.length > 0) {
      classes.push(...shadowClasses);
    }
  }
  
  return classes;
}

function generateTailwindTextClasses(textNode) {
  if (!textNode || !textNode.style) return [];
  
  const classes = [];
  
  // Font family
  if (textNode.style.fontFamily) {
    const fontFamily = fontFamilyToTailwind(textNode.style.fontFamily);
    if (fontFamily) classes.push(fontFamily);
  }
  
  // Font size
  if (textNode.style.fontSize) {
    const fontSize = fontSizeToTailwind(textNode.style.fontSize);
    if (fontSize) classes.push(fontSize);
  }
  
  // Font weight
  if (textNode.style.fontWeight) {
    const fontWeight = fontWeightToTailwind(textNode.style.fontWeight);
    if (fontWeight) classes.push(fontWeight);
  }
  
  // Line height
  if (textNode.style.lineHeightPx) {
    const lineHeight = lineHeightToTailwind(textNode.style.lineHeightPx);
    if (lineHeight) classes.push(lineHeight);
  }
  
  // Letter spacing
  if (textNode.style.letterSpacing) {
    const tracking = letterSpacingToTailwind(textNode.style.letterSpacing);
    if (tracking) classes.push(tracking);
  }
  
  // Text alignment
  if (textNode.style.textAlignHorizontal) {
    const textAlign = textAlignToTailwind(textNode.style.textAlignHorizontal);
    if (textAlign) classes.push(textAlign);
  }
  
  // Text color
  if (textNode.fills && textNode.fills.length > 0 && textNode.fills[0].color) {
    const textColor = colorToTailwindClass(textNode.fills[0].color, 'text');
    if (textColor) classes.push(textColor);
  }
  
  return classes;
}

function pxToTailwindSpacing(px) {
  // Convert pixel values to Tailwind spacing scale
  if (px <= 0) return null;
  
  if (px <= 1) return '0.5'; // 0.125rem = 2px
  if (px <= 2) return '1';   // 0.25rem = 4px
  if (px <= 3) return '1.5'; // 0.375rem = 6px
  if (px <= 5) return '2';   // 0.5rem = 8px
  if (px <= 7) return '3';   // 0.75rem = 12px
  if (px <= 10) return '4';  // 1rem = 16px
  if (px <= 14) return '5';  // 1.25rem = 20px
  if (px <= 18) return '6';  // 1.5rem = 24px
  if (px <= 22) return '7';  // 1.75rem = 28px
  if (px <= 26) return '8';  // 2rem = 32px
  if (px <= 34) return '10'; // 2.5rem = 40px
  if (px <= 42) return '12'; // 3rem = 48px
  if (px <= 56) return '16'; // 4rem = 64px
  
  return null; // Use custom size for larger values
}

function pxToTailwindBorderRadius(px) {
  if (px <= 0) return null;
  
  if (px <= 1) return 'sm';   // 0.125rem = 2px
  if (px <= 3) return 'DEFAULT'; // 0.25rem = 4px
  if (px <= 6) return 'md';   // 0.375rem = 6px
  if (px <= 9) return 'lg';   // 0.5rem = 8px
  if (px <= 12) return 'xl';  // 0.75rem = 12px
  if (px <= 16) return '2xl'; // 1rem = 16px
  if (px <= 20) return '3xl'; // 1.5rem = 24px
  
  return 'full'; // Use rounded-full for larger values or exact px
}

function pxToTailwindBorderWidth(px) {
  if (px <= 0) return null;
  
  if (px <= 1) return 'DEFAULT'; // 1px
  if (px <= 2) return '2';       // 2px
  if (px <= 4) return '4';       // 4px
  if (px <= 8) return '8';       // 8px
  
  return null; // Use custom width for larger values
}

function pxToTailwindSize(px, prefix) {
  // For w-* and h-* utilities
  if (px <= 0) return null;
  
  // Try to match standard sizes
  if (Math.abs(px - 16) <= 2) return `${prefix}-4`; // ~16px
  if (Math.abs(px - 24) <= 2) return `${prefix}-6`; // ~24px
  if (Math.abs(px - 32) <= 2) return `${prefix}-8`; // ~32px
  if (Math.abs(px - 40) <= 2) return `${prefix}-10`; // ~40px
  if (Math.abs(px - 48) <= 2) return `${prefix}-12`; // ~48px
  if (Math.abs(px - 64) <= 3) return `${prefix}-16`; // ~64px
  if (Math.abs(px - 80) <= 3) return `${prefix}-20`; // ~80px
  if (Math.abs(px - 96) <= 3) return `${prefix}-24`; // ~96px
  if (Math.abs(px - 128) <= 4) return `${prefix}-32`; // ~128px
  if (Math.abs(px - 160) <= 4) return `${prefix}-40`; // ~160px
  if (Math.abs(px - 192) <= 4) return `${prefix}-48`; // ~192px
  if (Math.abs(px - 256) <= 5) return `${prefix}-64`; // ~256px
  if (Math.abs(px - 320) <= 5) return `${prefix}-80`; // ~320px
  if (Math.abs(px - 384) <= 5) return `${prefix}-96`; // ~384px
  
  // For percentages or special cases
  if (Math.abs(px - 360) <= 5) return `${prefix}-full`; // could be full width in a container
  
  return null; // Use inline style for non-standard sizes
}

function extractPaddingClasses(node) {
  let classes = [];
  
  // Extract individual padding values if available
  if (node.paddingLeft !== undefined || node.paddingRight !== undefined || 
      node.paddingTop !== undefined || node.paddingBottom !== undefined) {
    
    // Check if all paddings are equal
    if (node.paddingLeft === node.paddingRight && 
        node.paddingLeft === node.paddingTop && 
        node.paddingLeft === node.paddingBottom &&
        node.paddingLeft !== undefined) {
      
      const p = pxToTailwindSpacing(node.paddingLeft);
      if (p) classes.push(`p-${p}`);
      
    } else {
      // Handle individual paddings
      if (node.paddingLeft !== undefined) {
        const pl = pxToTailwindSpacing(node.paddingLeft);
        if (pl) classes.push(`pl-${pl}`);
      }
      
      if (node.paddingRight !== undefined) {
        const pr = pxToTailwindSpacing(node.paddingRight);
        if (pr) classes.push(`pr-${pr}`);
      }
      
      if (node.paddingTop !== undefined) {
        const pt = pxToTailwindSpacing(node.paddingTop);
        if (pt) classes.push(`pt-${pt}`);
      }
      
      if (node.paddingBottom !== undefined) {
        const pb = pxToTailwindSpacing(node.paddingBottom);
        if (pb) classes.push(`pb-${pb}`);
      }
      
      // Try to simplify with px and py if possible
      if (node.paddingLeft === node.paddingRight && node.paddingLeft !== undefined) {
        const px = pxToTailwindSpacing(node.paddingLeft);
        if (px) {
          // Remove the individual classes
          classes = classes.filter(c => !c.startsWith('pl-') && !c.startsWith('pr-'));
          classes.push(`px-${px}`);
        }
      }
      
      if (node.paddingTop === node.paddingBottom && node.paddingTop !== undefined) {
        const py = pxToTailwindSpacing(node.paddingTop);
        if (py) {
          // Remove the individual classes
          classes = classes.filter(c => !c.startsWith('pt-') && !c.startsWith('pb-'));
          classes.push(`py-${py}`);
        }
      }
    }
  }
  
  return classes;
}

function extractShadowClasses(effects) {
  const classes = [];
  
  // Look for drop shadow effects
  const shadows = effects.filter(effect => effect.type === 'DROP_SHADOW' && effect.visible !== false);
  
  if (shadows.length > 0) {
    // Try to find the most prominent shadow
    let hasShadow = false;
    
    for (const shadow of shadows) {
      // Check for large outer shadow
      if (shadow.radius >= 16 && shadow.offset.y >= 8) {
        classes.push('shadow-xl');
        hasShadow = true;
        break;
      }
      // Check for medium shadow
      else if (shadow.radius >= 8 && shadow.offset.y >= 4) {
        classes.push('shadow-lg');
        hasShadow = true;
        break;
      }
      // Check for small shadow
      else if (shadow.radius >= 3) {
        classes.push('shadow-md');
        hasShadow = true;
        break;
      }
    }
    
    // If no specific size was determined but shadows exist
    if (!hasShadow && shadows.length > 0) {
      classes.push('shadow');
    }
  }
  
  return classes;
}

function colorToTailwindClass(color, prefix) {
  if (!color) return null;
  
  // Generate RGB values
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = color.a !== undefined ? color.a : 1;
  
  // Special case for black and white
  if (r === 0 && g === 0 && b === 0) {
    return `${prefix}-black`;
  }
  if (r === 255 && g === 255 && b === 255) {
    return `${prefix}-white`;
  }
  
  // Try to match to closest Tailwind color
  // These are rough approximations of common Tailwind colors
  
  // Grays
  if (Math.abs(r - g) < 10 && Math.abs(r - b) < 10) {
    const brightness = (r + g + b) / 3;
    
    if (brightness < 30) return `${prefix}-gray-950`;
    if (brightness < 50) return `${prefix}-gray-900`;
    if (brightness < 80) return `${prefix}-gray-800`;
    if (brightness < 110) return `${prefix}-gray-700`;
    if (brightness < 135) return `${prefix}-gray-600`;
    if (brightness < 160) return `${prefix}-gray-500`;
    if (brightness < 185) return `${prefix}-gray-400`;
    if (brightness < 210) return `${prefix}-gray-300`;
    if (brightness < 230) return `${prefix}-gray-200`;
    if (brightness < 245) return `${prefix}-gray-100`;
    return `${prefix}-gray-50`;
  }
  
  // Reds
  if (r > 170 && g < 100 && b < 100) {
    if (r > 240) return `${prefix}-red-500`;
    if (r > 220) return `${prefix}-red-600`;
    if (r > 200) return `${prefix}-red-700`;
    if (r > 180) return `${prefix}-red-800`;
    return `${prefix}-red-900`;
  }
  
  // Blues
  if (b > 170 && r < 100 && g < 160) {
    if (b > 240) return `${prefix}-blue-500`;
    if (b > 220) return `${prefix}-blue-600`;
    if (b > 200) return `${prefix}-blue-700`;
    if (b > 180) return `${prefix}-blue-800`;
    return `${prefix}-blue-900`;
  }
  
  // For transparency
  if (a < 0.2) return `${prefix}-transparent`;
  
  // If opacity is significant but not full
  if (a < 0.95) {
    return `${prefix}-opacity-${Math.round(a * 100)}`;
  }
  
  // Return null for colors that don't match standard Tailwind palette
  // Claude Code will need to suggest adding a custom color to the Tailwind config
  return null;
}

function fontFamilyToTailwind(fontFamily) {
  if (!fontFamily) return null;
  
  const normalizedFont = fontFamily.toLowerCase();
  
  if (normalizedFont.includes('inter')) return 'font-sans'; // Common UI font
  if (normalizedFont.includes('helvetica') || normalizedFont.includes('arial')) return 'font-sans';
  if (normalizedFont.includes('times') || normalizedFont.includes('georgia')) return 'font-serif';
  if (normalizedFont.includes('mono') || normalizedFont.includes('courier')) return 'font-mono';
  
  return null; // Custom font family
}

function fontSizeToTailwind(fontSize) {
  if (!fontSize) return null;
  
  if (fontSize <= 12) return 'text-xs';
  if (fontSize <= 14) return 'text-sm';
  if (fontSize <= 16) return 'text-base';
  if (fontSize <= 18) return 'text-lg';
  if (fontSize <= 20) return 'text-xl';
  if (fontSize <= 24) return 'text-2xl';
  if (fontSize <= 30) return 'text-3xl';
  if (fontSize <= 36) return 'text-4xl';
  if (fontSize <= 48) return 'text-5xl';
  if (fontSize <= 60) return 'text-6xl';
  if (fontSize <= 72) return 'text-7xl';
  if (fontSize <= 96) return 'text-8xl';
  if (fontSize <= 128) return 'text-9xl';
  
  return null; // Custom font size
}

function fontWeightToTailwind(fontWeight) {
  if (!fontWeight) return null;
  
  if (fontWeight <= 100) return 'font-thin';
  if (fontWeight <= 200) return 'font-extralight';
  if (fontWeight <= 300) return 'font-light';
  if (fontWeight <= 400) return 'font-normal';
  if (fontWeight <= 500) return 'font-medium';
  if (fontWeight <= 600) return 'font-semibold';
  if (fontWeight <= 700) return 'font-bold';
  if (fontWeight <= 800) return 'font-extrabold';
  if (fontWeight <= 900) return 'font-black';
  
  return 'font-black'; // Maximum weight
}

function lineHeightToTailwind(lineHeight) {
  if (!lineHeight) return null;
  
  if (lineHeight <= 16) return 'leading-none';
  if (lineHeight <= 20) return 'leading-tight';
  if (lineHeight <= 24) return 'leading-snug';
  if (lineHeight <= 28) return 'leading-normal';
  if (lineHeight <= 32) return 'leading-relaxed';
  if (lineHeight <= 40) return 'leading-loose';
  
  return null; // Custom line height
}

function letterSpacingToTailwind(letterSpacing) {
  if (!letterSpacing) return null;
  
  if (letterSpacing <= -0.05) return 'tracking-tighter';
  if (letterSpacing <= -0.025) return 'tracking-tight';
  if (letterSpacing >= -0.01 && letterSpacing <= 0.01) return 'tracking-normal';
  if (letterSpacing >= 0.025) return 'tracking-wide';
  if (letterSpacing >= 0.05) return 'tracking-wider';
  if (letterSpacing >= 0.1) return 'tracking-widest';
  
  return null; // Custom letter spacing
}

function textAlignToTailwind(textAlign) {
  if (!textAlign) return null;
  
  const align = textAlign.toLowerCase();
  
  if (align.includes('left')) return 'text-left';
  if (align.includes('center')) return 'text-center';
  if (align.includes('right')) return 'text-right';
  if (align.includes('justify')) return 'text-justify';
  
  return null;
}

function generateImplementationGuide(node) {
  const componentType = guessComponentType(node);
  const tailwindClasses = generateTailwindClasses(node);
  
  const guide = {
    recommendedApproach: "",
    tailwindConfig: {
      customColors: [],
      customFontFamily: [],
      customSpacing: []
    }
  };
  
  // Generate recommendations based on component type
  switch (componentType) {
    case 'confirmation-dialog':
      guide.recommendedApproach = `
This appears to be a confirmation dialog component. Consider using:
- Check if the host project already has a Dialog or Modal component
- Use existing Button components for the actions
- For the layout, use Tailwind flex utilities (${tailwindClasses.filter(c => c.startsWith('flex')).join(', ')})
- If the project uses React, consider using headlessui/Dialog or similar accessible components
`;
      break;
    case 'button':
      guide.recommendedApproach = `
This appears to be a button component. Consider using:
- Check if the host project already has a Button component with variants
- For styling, use the Tailwind classes: ${tailwindClasses.join(' ')}
- Match the existing button naming patterns in the project
`;
      break;
    default:
      guide.recommendedApproach = `
This component can be implemented using the generated Tailwind classes.
Look for similar components in the host project to maintain consistency.
`;
  }
  
  // Add any custom color suggestions
  if (node.backgroundColor) {
    const { r, g, b } = node.backgroundColor;
    if (colorToTailwindClass(node.backgroundColor, 'bg') === null) {
      const hexColor = rgbToHex(r, g, b);
      guide.tailwindConfig.customColors.push({
        name: suggestColorName(node.name, hexColor),
        value: hexColor
      });
    }
  }
  
  // Add text style suggestions
  if (node.children) {
    const textNodes = findTextNodes(node);
    textNodes.forEach(textNode => {
      if (textNode.fills && textNode.fills.length > 0) {
        const fill = textNode.fills[0];
        if (fill.type === 'SOLID' && colorToTailwindClass(fill.color, 'text') === null) {
          const { r, g, b } = fill.color;
          const hexColor = rgbToHex(r, g, b);
          guide.tailwindConfig.customColors.push({
            name: suggestColorName(textNode.name + "-text", hexColor),
            value: hexColor
          });
        }
      }
    });
  }
  
  return guide;
}

// Helper function to find all text nodes in a component tree
function findTextNodes(node, results = []) {
  if (!node) return results;
  
  if (node.type === 'TEXT') {
    results.push(node);
  }
  
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => findTextNodes(child, results));
  }
  
  return results;
}

// Helper function to convert RGB to HEX
function rgbToHex(r, g, b) {
  const toHex = (value) => {
    const hex = Math.round(value * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Helper function to suggest a color name based on component name and color value
function suggestColorName(componentName, hexColor) {
  // Simplify the component name to create a base for the color name
  const baseName = componentName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  
  // Check if it's a common color
  if (hexColor === '#000000') return 'black';
  if (hexColor === '#ffffff') return 'white';
  
  // For other colors, use component name and a suffix
  const r = parseInt(hexColor.substr(1, 2), 16);
  const g = parseInt(hexColor.substr(3, 2), 16);
  const b = parseInt(hexColor.substr(5, 2), 16);
  
  // Determine a color family
  let colorFamily = '';
  if (r > g && r > b) colorFamily = 'red';
  else if (g > r && g > b) colorFamily = 'green';
  else if (b > r && b > g) colorFamily = 'blue';
  else if (r === g && g === b) colorFamily = 'gray';
  else if (r > 200 && g > 200 && b < 100) colorFamily = 'yellow';
  else if (r > 200 && g < 100 && b > 200) colorFamily = 'purple';
  else if (r < 100 && g > 200 && b > 200) colorFamily = 'cyan';
  
  // Determine brightness for suffix
  const brightness = (r + g + b) / 3;
  let brightnessSuffix = '';
  
  if (brightness < 85) brightnessSuffix = 'dark';
  else if (brightness > 170) brightnessSuffix = 'light';
  
  if (baseName.includes(colorFamily)) {
    return brightnessSuffix ? `${baseName}-${brightnessSuffix}` : baseName;
  } else {
    return brightnessSuffix ? `${baseName}-${colorFamily}-${brightnessSuffix}` : `${baseName}-${colorFamily}`;
  }
}

program
  .command('extract <url>')
  .description('Extract metadata from a Figma URL')
  .option('-o, --output <path>', 'Output file path (defaults to stdout)')
  .option('-f, --format <format>', 'Output format (json, yaml)', 'json')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--optimize', 'Optimize output for component mapping')
  .action(async (url, options) => {
    try {
      const spinner = ora('Extracting metadata from Figma...').start();
      const metadata = await fetchNodeMetadata(url, options.verbose);
      spinner.succeed('Metadata extracted successfully');
      
      // If optimize flag is set, transform the metadata
      let processedData = metadata;
      if (options.optimize) {
        spinner.text = 'Optimizing for component mapping...';
        processedData = optimizeFigmaData(metadata);
        spinner.succeed('Data optimized for component mapping');
      }
      
      // Format the output
      let output;
      if (options.format === 'json') {
        output = JSON.stringify(processedData, null, 2);
      } else if (options.format === 'yaml') {
        // Simple JSON to YAML conversion
        const yaml = await import('js-yaml');
        output = yaml.default.dump(processedData);
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
          console.error('Please try re-authenticating with: figma-to-code auth --reset');
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