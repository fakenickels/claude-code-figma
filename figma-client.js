import fetch from 'node-fetch';

class FigmaClient {
  constructor(personalAccessToken, verbose = false) {
    this.personalAccessToken = personalAccessToken;
    this.baseURL = 'https://api.figma.com/v1';
    this.verbose = verbose;
  }

  // Helper for conditional logging based on verbose flag
  log(...args) {
    if (this.verbose) {
      console.log(...args);
    }
  }

  async request(endpoint) {
    const url = `${this.baseURL}${endpoint}`;
    this.log(`Making API request to: ${url}`);
    
    try {
      const response = await fetch(url, {
        headers: {
          'X-Figma-Token': this.personalAccessToken
        }
      });

      this.log(`Response status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        let errorText;
        try {
          const error = await response.json();
          errorText = `${error.status} ${error.err || response.statusText}`;
        } catch (e) {
          errorText = `${response.status} ${response.statusText}`;
        }
        throw new Error(`Figma API Error: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      if (error.message.includes('Figma API Error')) {
        throw error;
      }
      throw new Error(`Network error: ${error.message}`);
    }
  }

  async file(fileKey) {
    return this.request(`/files/${fileKey}`);
  }

  async fileNodes(fileKey, nodeIds) {
    const nodeIdsParam = Array.isArray(nodeIds) ? nodeIds.join(',') : nodeIds;
    return this.request(`/files/${fileKey}/nodes?ids=${nodeIdsParam}`);
  }

  async comments(fileKey) {
    return this.request(`/files/${fileKey}/comments`);
  }

  async images(fileKey, options = {}) {
    const { ids, scale = 1, format = 'png' } = options;
    const idsParam = Array.isArray(ids) ? ids.join(',') : ids;
    return this.request(`/images/${fileKey}?ids=${idsParam}&scale=${scale}&format=${format}`);
  }

  // Find a node in the document by its ID
  findNodeById(document, nodeId) {
    const queue = [document];
    
    while (queue.length > 0) {
      const node = queue.shift();
      
      // Check if this is the node we're looking for
      if (node.id === nodeId) {
        return node;
      }
      
      // If this node has children, add them to the queue
      if (node.children && Array.isArray(node.children)) {
        queue.push(...node.children);
      }
    }
    
    return null; // Node not found
  }

  // Extract all relevant properties from a node
  extractNodeProperties(node) {
    if (!node) return null;
    
    // Base properties that all nodes have
    const properties = {
      id: node.id,
      name: node.name,
      type: node.type,
      visible: node.visible !== false, // Default to true if not specified
    };
    
    // Position and size
    if (node.absoluteBoundingBox) {
      properties.position = {
        x: node.absoluteBoundingBox.x,
        y: node.absoluteBoundingBox.y,
      };
      properties.size = {
        width: node.absoluteBoundingBox.width,
        height: node.absoluteBoundingBox.height,
      };
    }
    
    // Rotation
    if (node.rotation !== undefined) {
      properties.rotation = node.rotation;
    }
    
    // Background
    if (node.backgroundColor) {
      properties.backgroundColor = this.formatColor(node.backgroundColor);
    }
    
    // Fills
    if (node.fills && node.fills.length > 0) {
      properties.fills = node.fills.map(fill => this.formatFill(fill));
    }
    
    // Strokes
    if (node.strokes && node.strokes.length > 0) {
      properties.strokes = node.strokes.map(stroke => this.formatFill(stroke));
      
      if (node.strokeWeight !== undefined) {
        properties.strokeWeight = node.strokeWeight;
      }
      
      if (node.strokeAlign !== undefined) {
        properties.strokeAlign = node.strokeAlign;
      }
    }
    
    // Border radius
    if (node.cornerRadius !== undefined) {
      properties.cornerRadius = node.cornerRadius;
    }
    
    // Individual corner radii
    if (node.topLeftRadius !== undefined || 
        node.topRightRadius !== undefined || 
        node.bottomLeftRadius !== undefined || 
        node.bottomRightRadius !== undefined) {
      
      properties.cornerRadii = {
        topLeft: node.topLeftRadius || 0,
        topRight: node.topRightRadius || 0,
        bottomRight: node.bottomRightRadius || 0,
        bottomLeft: node.bottomLeftRadius || 0
      };
    }
    
    // Effects (shadows, blurs)
    if (node.effects && node.effects.length > 0) {
      properties.effects = node.effects.map(effect => this.formatEffect(effect));
    }
    
    // Layout specific properties
    if (node.layoutMode !== undefined) {
      properties.layout = {
        mode: node.layoutMode, // "HORIZONTAL" or "VERTICAL"
        spacing: node.itemSpacing,
        padding: this.extractPadding(node),
        wrap: node.layoutWrap,
      };
      
      // Primary and counter axis sizing modes
      if (node.primaryAxisSizingMode !== undefined) {
        properties.layout.primaryAxisSizingMode = node.primaryAxisSizingMode;
      }
      
      if (node.counterAxisSizingMode !== undefined) {
        properties.layout.counterAxisSizingMode = node.counterAxisSizingMode;
      }
      
      // Primary and counter axis alignment
      if (node.primaryAxisAlignItems !== undefined) {
        properties.layout.primaryAxisAlignItems = node.primaryAxisAlignItems;
      }
      
      if (node.counterAxisAlignItems !== undefined) {
        properties.layout.counterAxisAlignItems = node.counterAxisAlignItems;
      }
    }
    
    // Text-specific properties
    if (node.type === 'TEXT') {
      properties.textContent = node.characters;
      
      if (node.style) {
        properties.textStyle = {
          fontFamily: node.style.fontFamily,
          fontSize: node.style.fontSize,
          fontWeight: node.style.fontWeight,
          lineHeight: node.style.lineHeightPx || node.style.lineHeightPercentFontSize,
          letterSpacing: node.style.letterSpacing,
          textAlign: node.style.textAlignHorizontal,
          verticalAlign: node.style.textAlignVertical,
          textCase: node.style.textCase, // "UPPER", "LOWER", "TITLE", "ORIGINAL"
          textDecoration: node.style.textDecoration, // "NONE", "UNDERLINE", "STRIKETHROUGH"
        };
      }
    }
    
    // Component instance properties
    if (node.type === 'INSTANCE') {
      properties.componentId = node.componentId;
      
      if (node.componentProperties) {
        properties.componentProperties = node.componentProperties;
      }
    }
    
    // Constraints
    if (node.constraints) {
      properties.constraints = node.constraints;
    }
    
    // Children (recursive)
    if (node.children && node.children.length > 0) {
      properties.children = node.children.map(child => this.extractNodeProperties(child));
    }
    
    return properties;
  }

  // Helper methods to format different types of properties
  formatColor(color) {
    if (!color) return null;
    
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    const a = color.a !== undefined ? color.a : 1;
    
    // Return hex if fully opaque, otherwise rgba
    if (a === 1) {
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    } else {
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
  }

  formatFill(fill) {
    if (!fill) return null;
    
    const result = { type: fill.type };
    
    switch (fill.type) {
      case 'SOLID':
        result.color = this.formatColor(fill.color);
        result.opacity = fill.opacity;
        break;
        
      case 'GRADIENT_LINEAR':
      case 'GRADIENT_RADIAL':
      case 'GRADIENT_ANGULAR':
      case 'GRADIENT_DIAMOND':
        result.gradientStops = fill.gradientStops.map(stop => ({
          position: stop.position,
          color: this.formatColor(stop.color)
        }));
        
        if (fill.gradientHandlePositions) {
          result.gradientHandlePositions = fill.gradientHandlePositions;
        }
        break;
        
      case 'IMAGE':
        result.imageRef = fill.imageRef;
        result.scaleMode = fill.scaleMode;
        result.opacity = fill.opacity;
        break;
    }
    
    return result;
  }

  formatEffect(effect) {
    if (!effect) return null;
    
    const result = { type: effect.type };
    
    switch (effect.type) {
      case 'DROP_SHADOW':
      case 'INNER_SHADOW':
        result.color = this.formatColor(effect.color);
        result.offset = effect.offset;
        result.radius = effect.radius;
        result.spread = effect.spread;
        result.visible = effect.visible !== false; // Default to true
        break;
        
      case 'LAYER_BLUR':
      case 'BACKGROUND_BLUR':
        result.radius = effect.radius;
        result.visible = effect.visible !== false; // Default to true
        break;
    }
    
    return result;
  }

  extractPadding(node) {
    const padding = {};
    
    // Check for individual padding values
    if (node.paddingLeft !== undefined) padding.left = node.paddingLeft;
    if (node.paddingRight !== undefined) padding.right = node.paddingRight;
    if (node.paddingTop !== undefined) padding.top = node.paddingTop;
    if (node.paddingBottom !== undefined) padding.bottom = node.paddingBottom;
    
    return Object.keys(padding).length > 0 ? padding : null;
  }

  // Generate AI-optimized description of a node and its properties
  generateAIPrompt(node) {
    if (!node) return '';
    
    let prompt = 'Your task is to create a React component that matches the following Figma design:\n\n';
    prompt += this.generateNodeDescription(node, 0);
    
    prompt += '\nThe component should be written in React with Tailwind CSS.\n';
    prompt += 'Assume that the host project uses React and Tailwind CSS, and you can reuse any existing components or styles from the project\'s scope.\n';
    prompt += 'Generate the complete React component code.\n';
    
    return prompt;
  }

  generateNodeDescription(node, indentLevel) {
    if (!node) return '';
    
    const indent = '  '.repeat(indentLevel);
    let description = `${indent}Design Element:\n`;
    
    // Basic properties
    description += `${indent}- Type: ${node.type}\n`;
    
    if (node.name) {
      description += `${indent}- Name: ${node.name}\n`;
    }
    
    // Size and position
    if (node.size) {
      description += `${indent}- Width: ${node.size.width}px\n`;
      description += `${indent}- Height: ${node.size.height}px\n`;
    }
    
    // Background color
    if (node.backgroundColor) {
      description += `${indent}- Background Color: ${node.backgroundColor}\n`;
    }
    
    // Corner radius
    if (node.cornerRadius) {
      description += `${indent}- Border Radius: ${node.cornerRadius}\n`;
    } else if (node.cornerRadii) {
      description += `${indent}- Border Radius: ${JSON.stringify(node.cornerRadii)}\n`;
    }
    
    // Fills
    if (node.fills && node.fills.length > 0) {
      node.fills.forEach((fill, i) => {
        if (fill.type === 'SOLID') {
          description += `${indent}- Fill${node.fills.length > 1 ? ` ${i+1}` : ''}: ${fill.color}\n`;
        } else if (fill.type.startsWith('GRADIENT')) {
          description += `${indent}- Fill${node.fills.length > 1 ? ` ${i+1}` : ''}: ${fill.type.replace('GRADIENT_', '').toLowerCase()} gradient (${fill.gradientStops.map(stop => stop.color).join(' to ')})\n`;
        }
      });
    }
    
    // Strokes
    if (node.strokes && node.strokes.length > 0) {
      description += `${indent}- Border: ${node.strokeWeight}px ${node.strokes[0].type.toLowerCase()} ${node.strokes[0].color}\n`;
    }
    
    // Effects
    if (node.effects && node.effects.length > 0) {
      node.effects.forEach((effect, i) => {
        if (effect.type === 'DROP_SHADOW') {
          description += `${indent}- Shadow: ${effect.radius}px ${effect.color} offset(${effect.offset.x}, ${effect.offset.y})\n`;
        } else if (effect.type === 'INNER_SHADOW') {
          description += `${indent}- Inner Shadow: ${effect.radius}px ${effect.color} offset(${effect.offset.x}, ${effect.offset.y})\n`;
        } else if (effect.type.includes('BLUR')) {
          description += `${indent}- ${effect.type.replace('_', ' ').toLowerCase()}: ${effect.radius}px\n`;
        }
      });
    }
    
    // Layout properties
    if (node.layout) {
      description += `${indent}- Layout: ${node.layout.mode === 'HORIZONTAL' ? 'Row' : 'Column'}\n`;
      
      if (node.layout.spacing) {
        description += `${indent}- Gap: ${node.layout.spacing}px\n`;
      }
      
      if (node.layout.padding) {
        const padding = node.layout.padding;
        description += `${indent}- Padding: `;
        
        if (padding.top === padding.right && padding.right === padding.bottom && padding.bottom === padding.left) {
          description += `${padding.top}px\n`;
        } else {
          description += `${padding.top || 0}px ${padding.right || 0}px ${padding.bottom || 0}px ${padding.left || 0}px\n`;
        }
      }
      
      if (node.layout.primaryAxisSizingMode) {
        description += `${indent}- Primary Axis Sizing: ${node.layout.primaryAxisSizingMode}\n`;
      }
      
      if (node.layout.counterAxisSizingMode) {
        description += `${indent}- Counter Axis Sizing: ${node.layout.counterAxisSizingMode}\n`;
      }
    }
    
    // Text content
    if (node.type === 'TEXT') {
      description += `${indent}- Text: "${node.textContent}"\n`;
      
      if (node.textStyle) {
        if (node.textStyle.fontFamily) {
          description += `${indent}- Font Family: ${node.textStyle.fontFamily}\n`;
        }
        
        if (node.textStyle.fontSize) {
          description += `${indent}- Font Size: ${node.textStyle.fontSize}px\n`;
        }
        
        if (node.textStyle.fontWeight) {
          description += `${indent}- Font Weight: ${node.textStyle.fontWeight}\n`;
        }
        
        if (node.textStyle.lineHeight) {
          description += `${indent}- Line Height: ${node.textStyle.lineHeight}\n`;
        }
        
        if (node.textStyle.letterSpacing) {
          description += `${indent}- Letter Spacing: ${node.textStyle.letterSpacing}\n`;
        }
        
        if (node.textStyle.textAlign) {
          description += `${indent}- Text Alignment: ${node.textStyle.textAlign.toLowerCase()}\n`;
        }
        
        if (node.textStyle.textCase && node.textStyle.textCase !== 'ORIGINAL') {
          description += `${indent}- Text Case: ${node.textStyle.textCase.toLowerCase()}\n`;
        }
        
        if (node.textStyle.textDecoration && node.textStyle.textDecoration !== 'NONE') {
          description += `${indent}- Text Decoration: ${node.textStyle.textDecoration.toLowerCase()}\n`;
        }
      }
    }
    
    // Component instance properties
    if (node.type === 'INSTANCE' && node.componentProperties) {
      description += `${indent}- Component Properties:\n`;
      Object.entries(node.componentProperties).forEach(([key, value]) => {
        description += `${indent}  - ${key}: ${value.type === 'BOOLEAN' ? (value.value ? 'true' : 'false') : value.value}\n`;
      });
    }
    
    // Children
    if (node.children && node.children.length > 0) {
      description += `${indent}- Contains:\n`;
      node.children.forEach(child => {
        description += this.generateNodeDescription(child, indentLevel + 1);
      });
    }
    
    return description;
  }
}

export default FigmaClient;