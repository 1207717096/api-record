#!/usr/bin/env node
/**
 * API Recorder CLI 入口
 * 用法：
 *   record <url>                 启动录制并打开指定 URL
 *   record <url> -o ./out.json   指定输出文件路径
 *   record <url> --no-headless   使用有头模式（默认有头）
 *   record --help                查看帮助
 */

const path = require('path');
const fs = require('fs');
const { Command } = require('commander');
const chalk = require('chalk');
const Recorder = require('../src/recorder');

const program = new Command();

program
  .name('record')
  .description('网页接口录制工具 - 录制浏览器网络请求并导出为 JSON')
  .version('1.0.0')
  .argument('<url>', '要打开并录制接口的目标网址')
  .option('-o, --output <path>', '接口文件输出路径，默认 ./api-records/<timestamp>.json')
  .option('--width <number>', '浏览器宽度', '1440')
  .option('--height <number>', '浏览器高度', '900')
  .option('--user-data-dir <path>', 'Chrome 用户数据目录，用于保留登录状态')
  .option('--chrome-path <path>', '指定 Chrome 可执行文件路径，默认自动探测')
  .option('--ignore <patterns>', '忽略的 URL 模式（逗号分隔），例如 "*.png,*.css"')
  .action(async (url, options) => {
    try {
      // 校验 URL
      let targetUrl = url;
      if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = 'https://' + targetUrl;
      }
      new URL(targetUrl); // 触发非法 URL 异常

      // 处理输出路径
      const outputPath = resolveOutputPath(options.output);

      // 处理忽略规则
      const ignorePatterns = options.ignore
        ? options.ignore.split(',').map((s) => s.trim()).filter(Boolean)
        : [];

      console.log(chalk.cyan.bold('\n🎬  API Recorder 启动中...\n'));
      console.log(chalk.gray('  目标网址：'), chalk.white(targetUrl));
      console.log(chalk.gray('  输出文件：'), chalk.white(outputPath));
      if (ignorePatterns.length) {
        console.log(chalk.gray('  忽略规则：'), chalk.white(ignorePatterns.join(', ')));
      }
      console.log();

      const recorder = new Recorder({
        url: targetUrl,
        outputPath,
        width: parseInt(options.width, 10),
        height: parseInt(options.height, 10),
        userDataDir: options.userDataDir,
        chromePath: options.chromePath,
        ignorePatterns,
      });

      await recorder.start();
    } catch (err) {
      if (err.code === 'ERR_INVALID_URL') {
        console.error(chalk.red(`\n✖ 非法 URL：${url}\n`));
      } else {
        console.error(chalk.red('\n✖ 启动失败：'), err.message);
        if (process.env.DEBUG) console.error(err.stack);
      }
      process.exit(1);
    }
  });

program.parseAsync(process.argv);

/**
 * 解析输出路径，默认存放在工具目录下的 api-records/ 子目录
 */
function resolveOutputPath(input) {
  if (input) {
    const abs = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    return abs;
  }
  const toolDir = path.resolve(__dirname, '..');
  const recordsDir = path.join(toolDir, 'api-records');
  fs.mkdirSync(recordsDir, { recursive: true });
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  return path.join(recordsDir, `apis_${ts}.json`);
}
