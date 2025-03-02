#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

// Get the user's home directory
const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.figma-to-code');
const TOKEN_PATH = path.join(CONFIG_DIR, 'auth.json');

async function testToken() {
  console.log('Testing Figma API token...');
  
  // Check if token exists
  if (!fs.existsSync(TOKEN_PATH)) {
    console.error('No auth token found. Please run "figma-to-code auth" first.');
    process.exit(1);
  }
  
  // Read the token
  let token;
  try {
    const tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    token = tokenData.token;
    console.log('Token found.');
  } catch (error) {
    console.error('Error reading auth token:', error.message);
    process.exit(1);
  }
  
  // Test a simple API call (get user info)
  try {
    console.log('Making test request to Figma API...');
    const response = await fetch('https://api.figma.com/v1/me', {
      headers: {
        'X-Figma-Token': token
      }
    });
    
    console.log(`Response status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      console.error('API request failed. Your token may be invalid or expired.');
      process.exit(1);
    }
    
    const data = await response.json();
    console.log('API request successful!');
    console.log('User info:');
    console.log(`- Email: ${data.email}`);
    console.log(`- ID: ${data.id}`);
    console.log(`- Handle: ${data.handle}`);
    console.log('Your Figma API token is working correctly.');
  } catch (error) {
    console.error('Error testing token:', error.message);
    process.exit(1);
  }
}

testToken();