#!/usr/bin/env node

// A simple script to generate a logo using node-canvas
// First run: npm install canvas

import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';

// Create a canvas
const size = 512;
const canvas = createCanvas(size, size);
const ctx = canvas.getContext('2d');

// Background
ctx.fillStyle = '#5436DA'; // Claude purple background
ctx.fillRect(0, 0, size, size);

// Create figma-like shape
ctx.fillStyle = 'white';
const shapeSize = size * 0.5;
ctx.fillRect(size * 0.25, size * 0.25, shapeSize, shapeSize);

// Add code brackets
ctx.fillStyle = '#5436DA';
ctx.font = 'bold 120px sans-serif';

// Left bracket
ctx.fillText('{', size * 0.35, size * 0.62);

// Right bracket
ctx.fillText('}', size * 0.54, size * 0.62);

// Add circle in corner to represent figma node
ctx.fillStyle = '#0ACF83'; // Figma green
ctx.beginPath();
ctx.arc(size * 0.75, size * 0.25, size * 0.1, 0, Math.PI * 2);
ctx.fill();

// Add text
ctx.fillStyle = 'white';
ctx.font = 'bold 40px sans-serif';
ctx.textAlign = 'center';
ctx.fillText('CLAUDE CODE', size / 2, size * 0.8);
ctx.fillText('FIGMA', size / 2, size * 0.88);

// Save the image
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(path.join(process.cwd(), 'logo.png'), buffer);
console.log('Logo saved as logo.png');