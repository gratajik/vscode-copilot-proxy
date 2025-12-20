#!/usr/bin/env node

/**
 * Feature Inventory Generator
 *
 * Scans docs/features/ for all feature folders and updates
 * the "Recently Added" and status sections in FEATURE_INVENTORY.md
 *
 * @see docs/features/knowledge-management/design.md
 */

const fs = require('fs');
const path = require('path');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const FEATURES_DIR = path.join(DOCS_DIR, 'features');
const INVENTORY_PATH = path.join(DOCS_DIR, 'FEATURE_INVENTORY.md');

// ANSI color codes
const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

function log(color, message) {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Extract status from TASKS.md content
 */
function extractStatus(tasksContent) {
    // Look for status patterns
    const statusMatch = tasksContent.match(/\*\*Status:\*\*\s*(\w+(?:\s+\w+)*)/i);
    if (statusMatch) {
        const status = statusMatch[1].toLowerCase();
        if (status.includes('complete') || status.includes('done')) {
            return 'Complete';
        } else if (status.includes('progress') || status.includes('partial')) {
            return 'In Progress';
        }
    }

    // Check for completed tasks
    const completedCount = (tasksContent.match(/-\s+\[x\]/g) || []).length;
    const pendingCount = (tasksContent.match(/-\s+\[ \]/g) || []).length;
    const inProgressCount = (tasksContent.match(/-\s+\[>\]/g) || []).length;

    if (completedCount > 0 && pendingCount === 0 && inProgressCount === 0) {
        return 'Complete';
    } else if (completedCount > 0 || inProgressCount > 0) {
        return 'In Progress';
    }

    return 'Not Started';
}

/**
 * Get feature info from a feature folder
 */
function getFeatureInfo(featureName) {
    const featurePath = path.join(FEATURES_DIR, featureName);
    const info = {
        name: featureName,
        hasDesign: false,
        hasTasks: false,
        status: 'Not Started',
        description: ''
    };

    // Check for design.md
    const designPath = path.join(featurePath, 'design.md');
    if (fs.existsSync(designPath)) {
        info.hasDesign = true;
        const content = fs.readFileSync(designPath, 'utf8');
        // Extract first paragraph as description
        const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
        if (lines.length > 0) {
            info.description = lines[0].trim().substring(0, 100);
        }
    }

    // Check for TASKS.md
    const tasksPath = path.join(featurePath, 'TASKS.md');
    if (fs.existsSync(tasksPath)) {
        info.hasTasks = true;
        const content = fs.readFileSync(tasksPath, 'utf8');
        info.status = extractStatus(content);
    }

    return info;
}

/**
 * Generate a summary report
 */
function generateReport(features) {
    console.log('\n=== Feature Inventory Report ===\n');

    const complete = features.filter(f => f.status === 'Complete');
    const inProgress = features.filter(f => f.status === 'In Progress');
    const notStarted = features.filter(f => f.status === 'Not Started');

    console.log(`Total features: ${features.length}`);
    log('green', `  Complete: ${complete.length}`);
    log('yellow', `  In Progress: ${inProgress.length}`);
    log('blue', `  Not Started: ${notStarted.length}`);
    console.log();

    // List issues
    const missingDesign = features.filter(f => !f.hasDesign);
    const missingTasks = features.filter(f => !f.hasTasks);

    if (missingDesign.length > 0) {
        log('red', 'Missing design.md:');
        for (const f of missingDesign) {
            console.log(`  - ${f.name}`);
        }
    }

    if (missingTasks.length > 0) {
        log('red', 'Missing TASKS.md:');
        for (const f of missingTasks) {
            console.log(`  - ${f.name}`);
        }
    }

    // Table
    console.log('\n| Feature | design.md | TASKS.md | Status |');
    console.log('|---------|-----------|----------|--------|');
    for (const f of features) {
        const design = f.hasDesign ? 'Yes' : 'No';
        const tasks = f.hasTasks ? 'Yes' : 'No';
        console.log(`| ${f.name} | ${design} | ${tasks} | ${f.status} |`);
    }
}

/**
 * Update the inventory file with current date
 */
function updateInventoryDate() {
    if (!fs.existsSync(INVENTORY_PATH)) {
        log('yellow', 'FEATURE_INVENTORY.md not found - run npm run docs:check first');
        return;
    }

    let content = fs.readFileSync(INVENTORY_PATH, 'utf8');
    const today = new Date().toISOString().split('T')[0];

    // Update Last Updated date
    content = content.replace(
        /\*\*Last Updated:\*\* \d{4}-\d{2}-\d{2}/,
        `**Last Updated:** ${today}`
    );

    fs.writeFileSync(INVENTORY_PATH, content);
    log('green', `Updated FEATURE_INVENTORY.md date to ${today}`);
}

/**
 * Main function
 */
function main() {
    console.log('\n=== Feature Inventory Update ===\n');

    // Check features directory exists
    if (!fs.existsSync(FEATURES_DIR)) {
        log('red', 'docs/features/ directory does not exist');
        process.exit(1);
    }

    // Get all feature folders
    const featureDirs = fs.readdirSync(FEATURES_DIR)
        .filter(f => fs.statSync(path.join(FEATURES_DIR, f)).isDirectory());

    console.log(`Found ${featureDirs.length} feature folder(s)\n`);

    // Get info for each feature
    const features = featureDirs.map(getFeatureInfo);

    // Generate report
    generateReport(features);

    // Update inventory date
    console.log();
    updateInventoryDate();

    console.log('\n=== Done ===\n');
}

main();
