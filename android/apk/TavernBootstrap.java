package com.deepseekharness.app.core;

import android.content.Context;
import android.content.SharedPreferences;
import com.deepseekharness.app.runtime.ProotBootstrap;
import com.deepseekharness.app.util.Compat;
import com.deepseekharness.app.util.InstallProcess;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import org.json.JSONObject;

/** 在现有启动锁内安装或升级；只有完整安装成功后才留下完成标记。 */
public final class TavernBootstrap {
    private TavernBootstrap() { }

    /** 默认走 npmmirror；依赖下载失败时用官方源再试一次，避免 APK 内无法改环境变量。 */
    private static final String FALLBACK_REGISTRY = "https://registry.npmjs.org";
    /** APK 内置离线包（源码 + pnpm store + pnpm 运行时），首装与升级都不必联网。 */
    private static final String OFFLINE_ASSET = "tavern-offline.bin";
    /** 容器内落地名；内容仍是 gzip 压缩的 tar（aapt 会把 .tar.gz 静默解成 .tar，故用 .bin）。 */
    private static final String OFFLINE_FILE = "tavern-offline.tar";
    /** 内置快照的提交、版本与构建时间；原生层据此判断这个 APK 是否已经装过。 */
    private static final String META_ASSET = "tavern-offline-meta.json";
    private static final String PREFS = "tavern-apk";
    /** 安装被中断时的续装标记与重试次数；换 APK 后重置。 */
    private static final String PREF_UPGRADE_PENDING = "upgradePending";
    private static final String PREF_UPGRADE_ATTEMPTS = "upgradeAttempts";
    private static final String PREF_UPGRADE_REVISION = "upgradeRevision";

    public static void ensure(Context context, ProotBootstrap boot,
                              BooleanSupplier cancelled, Consumer<String> status) throws Exception {
        File root = boot.getRootfsDir();
        File marker = new File(root, "root/.dsh/tavern-apk-installed");
        File profile = new File(root, "root/.dsh/profiles/tavern/package.json");
        File source = new File(root, "root/.dsh/apps/dsh-tavern/bin/dsh-tavern.mjs");
        JSONObject bundle = readBundle(context);
        String bundleRevision = bundle == null ? "" : bundle.optString("revision", "");
        SharedPreferences prefs = context.getSharedPreferences(PREFS, 0);
        if (marker.isFile() && profile.isFile() && source.isFile()) {
            // 覆盖安装不重装：只有两种情况才跑离线安装——
            // 1) 上次安装被中断（pending），下次启动续装，最多两次；
            // 2) APK 内置的源码版本比已装的高，才离线升级。
            // 同版本重打包（例如只改安装器/签名）不再重装，用户装完直接进酒馆。
            if (bundle == null || bundleRevision.isEmpty()) return;
            boolean pending = prefs.getBoolean(PREF_UPGRADE_PENDING, false);
            int attempts = bundleRevision.equals(prefs.getString(PREF_UPGRADE_REVISION, ""))
                    ? prefs.getInt(PREF_UPGRADE_ATTEMPTS, 0) : 0;
            if (pending) {
                if (attempts >= 2) return;
            } else if (!bundleIsNewer(root, bundle)) {
                return;
            }
            prefs.edit()
                    .putString(PREF_UPGRADE_REVISION, bundleRevision)
                    .putBoolean(PREF_UPGRADE_PENDING, true)
                    .putInt(PREF_UPGRADE_ATTEMPTS, attempts + 1)
                    .apply();
            status.accept(pending
                    ? "升级：正在继续上次未完成的离线安装，无需联网。请保持应用打开……"
                    : "升级：正在用应用内置的新版酒馆离线更新，无需联网。请保持应用打开……");
            if (applyBundle(context, boot, root, bundle, pending, cancelled, status)) {
                prefs.edit().putBoolean(PREF_UPGRADE_PENDING, false).putInt(PREF_UPGRADE_ATTEMPTS, 0).apply();
                return;
            }
            // setup.sh 会把源码回滚；不要让应用打不开，下次启动再补装（最多两次）。
            status.accept("内置快照升级未完成，继续使用原版本；详情见 .dsh/logs/tavern-install.log");
            return;
        }
        status.accept("首次安装：正在解包内置依赖（无需联网），请保持应用打开……");
        writeSetupScript(context, root);
        copyOfflineBundle(context, root, bundleRevision, "首次安装", cancelled, status);
        int exit = run(boot, "", false, cancelled, status);
        if (exit != 0) {
            status.accept("内置依赖安装未完成，正在改用官方 npm 源重试……");
            exit = run(boot, " DSH_TAVERN_NPM_REGISTRY=" + FALLBACK_REGISTRY, true, cancelled, status);
        }
        if (exit != 0) throw new java.io.IOException("酒馆安装失败，可检查网络后点击启动重试；日志：.dsh/logs/tavern-install.log");
        if (!profile.isFile() || !source.isFile()) throw new java.io.IOException("酒馆安装结果不完整，请重试");
        Compat.write(marker, "1\n".getBytes(StandardCharsets.UTF_8));
    }

    /** APK 内置的源码版本高于已装版本才离线升级；同版本覆盖安装直接跳过。 */
    private static boolean bundleIsNewer(File root, JSONObject bundle) {
        String installed = readInstalledVersion(root);
        String bundled = bundle.optString("version", "");
        if (installed.isEmpty() || bundled.isEmpty()) return false;
        return compareVersions(bundled, installed) > 0;
    }

    private static String readInstalledVersion(File root) {
        JSONObject pkg = readJson(new File(root, "root/.dsh/apps/dsh-tavern/package.json"));
        return pkg == null ? "" : pkg.optString("version", "");
    }

    /** 只比较数字段；预发布后缀按发布版处理，够用于“是否升级”的判断。 */
    private static int compareVersions(String left, String right) {
        String[] a = left.replaceAll("[^0-9.].*$", "").split("\\.");
        String[] b = right.replaceAll("[^0-9.].*$", "").split("\\.");
        try {
            for (int i = 0; i < Math.max(a.length, b.length); i++) {
                int l = i < a.length && !a[i].isEmpty() ? Integer.parseInt(a[i]) : 0;
                int r = i < b.length && !b[i].isEmpty() ? Integer.parseInt(b[i]) : 0;
                if (l != r) return l < r ? -1 : 1;
            }
        } catch (NumberFormatException error) {
            return 0;
        }
        return 0;
    }

    private static boolean applyBundle(Context context, ProotBootstrap boot, File root, JSONObject bundle,
                                       boolean repair, BooleanSupplier cancelled, Consumer<String> status) throws Exception {
        String revision = bundle.optString("revision", "");
        writeSetupScript(context, root);
        copyOfflineBundle(context, root, revision, "升级", cancelled, status);
        // 续装/修复时必须把依赖完整装一遍：中断过的 node_modules 不能当成就绪。
        String force = repair ? " DSH_TAVERN_FORCE_DEPENDENCIES=1" : "";
        int exit = run(boot, " DSH_TAVERN_APK_BUNDLE_UPDATE=1 DSH_TAVERN_APK_BUNDLE_REVISION=" + revision + force,
                false, cancelled, status);
        if (exit != 0) return false;
        File profile = new File(root, "root/.dsh/profiles/tavern/package.json");
        File source = new File(root, "root/.dsh/apps/dsh-tavern/bin/dsh-tavern.mjs");
        return profile.isFile() && source.isFile();
    }

    private static void writeSetupScript(Context context, File root) throws Exception {
        File script = new File(root, "root/tavern-apk-setup.sh");
        try (InputStream in = context.getAssets().open("tavern-apk-setup.sh");
             FileOutputStream out = new FileOutputStream(script)) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
        }
    }

    /**
     * 把内置离线包流式拷进容器；失败不阻断，setup.sh 会自动回退成联网安装。
     * 记录提交号：同一个 APK 的残留包直接复用，换了 APK 必须整包重拷，避免用旧快照升级。
     */
    private static void copyOfflineBundle(Context context, File root, String revision, String label,
                                          BooleanSupplier cancelled, Consumer<String> status) {
        File target = new File(root, "root/" + OFFLINE_FILE);
        File partial = new File(root, "root/" + OFFLINE_FILE + ".part");
        File sidecar = new File(root, "root/" + OFFLINE_FILE + ".revision");
        try {
            boolean present = false;
            for (String name : context.getAssets().list("")) if (OFFLINE_ASSET.equals(name)) { present = true; break; }
            if (!present) return;
            // 上次已经解包成功（例如安装中途被杀）时不必重拷 128 MB；残留 tar 也一并清掉。
            if (bundleExtracted(root, revision)) {
                target.delete();
                sidecar.delete();
                return;
            }
            if (target.isFile() && target.length() > 0) {
                String existing = readText(sidecar);
                if (revision.isEmpty() || revision.equals(existing == null ? "" : existing.trim())) return;
                target.delete();
                sidecar.delete();
            }
            long declaredSize = -1;
            try (InputStream probe = context.getAssets().open(OFFLINE_ASSET)) { declaredSize = probe.available(); }
            catch (Exception ignored) { }
            status.accept(label + "：正在释放内置依赖包，约需 1-2 分钟……");
            try (InputStream in = context.getAssets().open(OFFLINE_ASSET);
                 FileOutputStream out = new FileOutputStream(partial)) {
                byte[] buffer = new byte[1 << 20];
                long copied = 0;
                int count;
                while ((count = in.read(buffer)) != -1) {
                    if (cancelled.getAsBoolean()) throw new java.io.IOException("安装已取消");
                    out.write(buffer, 0, count);
                    copied += count;
                    if (declaredSize > 0 && copied % (32L << 20) < count) {
                        status.accept(label + "：释放内置依赖包 " + (copied * 100 / declaredSize) + "%……");
                    }
                }
            }
            if (!partial.renameTo(target)) throw new java.io.IOException("离线包落盘失败");
            if (!revision.isEmpty()) Compat.write(sidecar, (revision + "\n").getBytes(StandardCharsets.UTF_8));
        } catch (Exception error) {
            status.accept("内置依赖包不可用，将改用联网安装……");
            // 半成品会让 setup.sh 解压失败；删掉它保证回退路径干净。
            if (target.isFile() && !target.delete()) { /* 忽略：setup.sh 会在解压失败时回退 */ }
            if (partial.isFile() && !partial.delete()) { /* 同上 */ }
            if (sidecar.isFile() && !sidecar.delete()) { /* 同上 */ }
        }
    }

    /** 容器里已有本次 APK 解包好的快照（revision + source + store 齐全）。 */
    private static boolean bundleExtracted(File root, String revision) {
        if (revision.isEmpty()) return false;
        File offline = new File(root, "root/.dsh/tavern-offline");
        String extracted = readText(new File(offline, "revision"));
        return extracted != null && revision.equals(extracted.trim())
                && new File(offline, "store").isDirectory()
                && new File(offline, "source").isDirectory();
    }

    private static int run(ProotBootstrap boot, String extraEnvironment, boolean append,
                           BooleanSupplier cancelled, Consumer<String> status) throws Exception {
        // pnpm 默认单请求 60 秒超时，慢速移动网络下载大包会批量报 error (23)；
        // 提到 10 分钟，且 install.sh 的 pnpm 包装也会显式传同一个上限。
        String command = "set -o pipefail; export DSH_TAVERN_ANDROID_STANDALONE=1"
                + " pnpm_config_fetch_timeout=600000" + extraEnvironment
                + "; mkdir -p /root/.dsh/logs; "
                + "bash /root/tavern-apk-setup.sh 2>&1 | tee "
                + (append ? "-a " : "") + "/root/.dsh/logs/tavern-install.log";
        return InstallProcess.read(boot.execRootfsForInstall(command), 3600000L,
                true, cancelled, status, Compat::destroy);
    }

    private static JSONObject readBundle(Context context) {
        String text = readAsset(context, META_ASSET);
        if (text == null) return null;
        try {
            JSONObject meta = new JSONObject(text);
            String revision = meta.optString("revision", "");
            return revision.matches("[0-9a-fA-F]{40}") ? meta : null;
        } catch (Exception error) {
            return null;
        }
    }

    private static JSONObject readJson(File file) {
        String text = readText(file);
        if (text == null) return null;
        if (text.startsWith("\uFEFF")) text = text.substring(1);
        try { return new JSONObject(text); } catch (Exception error) { return null; }
    }

    private static String readText(File file) {
        try {
            if (!file.isFile()) return null;
            try (InputStream in = new FileInputStream(file)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192]; int count;
                while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
                return new String(out.toByteArray(), StandardCharsets.UTF_8);
            }
        } catch (Exception error) {
            return null;
        }
    }

    private static String readAsset(Context context, String name) {
        try (InputStream in = context.getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096]; int count;
            while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception error) {
            return null;
        }
    }
}
