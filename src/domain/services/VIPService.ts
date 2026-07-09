import {Collection, MongoClient} from 'mongodb';
import {BotConfig, getBotConfigService, log} from '../../infrastructure/config/config.js';
import {getActiveMongoClient} from '../../infrastructure/config/mongo.js';

export interface VIPUser {
    userJid: string; // WhatsApp JID
    grantedAt: Date;
    expiresAt: Date | null; // null = lifetime VIP
    grantedBy: string; // Admin who granted VIP
    redeemedCode?: string; // Code used to redeem VIP (if applicable)
    active: boolean;
}

export interface VIPCode {
    code: string; // Unique code string
    duration: number; // Duration in days (0 = lifetime)
    maxUses: number; // Maximum number of redemptions (0 = unlimited)
    currentUses: number; // Current number of redemptions
    createdAt: Date;
    expiresAt: Date | null; // Code expiration date (null = never expires)
    createdBy: string; // Admin who created the code
    active: boolean; // Whether code is still valid
}

export interface VIPStats {
    totalVIPs: number;
    activeVIPs: number;
    expiredVIPs: number;
    totalCodes: number;
    activeCodes: number;
    totalRedemptions: number;
}

export class VIPService {
    private static instance: VIPService | null = null;
    private dbName: string;
    private vipCollectionName: string;
    private codeCollectionName: string;

    private get vipCollection(): Collection<VIPUser> {
        return getActiveMongoClient().db(this.dbName).collection<VIPUser>(this.vipCollectionName);
    }

    private get codeCollection(): Collection<VIPCode> {
        return getActiveMongoClient().db(this.dbName).collection<VIPCode>(this.codeCollectionName);
    }

    constructor(
        _mongoClient: MongoClient,
        dbName = BotConfig.sessionName,
        vipCollectionName = 'vip_users',
        codeCollectionName = 'vip_codes'
    ) {
        this.dbName = dbName;
        this.vipCollectionName = vipCollectionName;
        this.codeCollectionName = codeCollectionName;
        // Don't call createIndexes here - will be called in getInstance
    }

    static async getInstance(): Promise<VIPService> {
        if (!VIPService.instance) {
            const {getMongoClient} = await import('../../infrastructure/config/mongo.js');
            const mongoClient = await getMongoClient();
            VIPService.instance = new VIPService(mongoClient);
            await VIPService.instance.createIndexes();
        }
        return VIPService.instance;
    }

    /**
     * Check if a user has active VIP status
     */
    async isVIP(userJid: string): Promise<boolean> {
        try {
            const vipUser = await this.vipCollection.findOne({
                userJid,
                active: true,
            });

            if (!vipUser) return false;

            // Check if VIP has expired
            if (vipUser.expiresAt && vipUser.expiresAt < new Date()) {
                // Mark as inactive
                await this.vipCollection.updateOne({userJid}, {$set: {active: false}});

                // Remove from vips role
                try {
                    const configService = await getBotConfigService();
                    await configService.removeUserFromRole(userJid, 'vip');
                } catch (error) {
                    log.error('Error removing expired VIP from role:', error);
                }

                return false;
            }

            return true;
        } catch (error) {
            log.error('Error checking VIP status:', error);
            return false;
        }
    }

    /**
     * Get VIP user details
     */
    async getVIPUser(userJid: string): Promise<VIPUser | null> {
        try {
            return await this.vipCollection.findOne({userJid});
        } catch (error) {
            log.error('Error getting VIP user:', error);
            return null;
        }
    }

    /**
     * Grant VIP status to a user
     */
    async grantVIP(userJid: string, durationDays: number, grantedBy: string): Promise<boolean> {
        try {
            const now = new Date();
            const expiresAt = durationDays === 0 ? null : new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

            await this.vipCollection.updateOne(
                {userJid},
                {
                    $set: {
                        userJid,
                        grantedAt: now,
                        expiresAt,
                        grantedBy,
                        active: true,
                    },
                },
                {upsert: true}
            );

            // Add to VIP role in config
            const configService = await getBotConfigService();
            await configService.addUserToRole(userJid, 'vip', grantedBy);

            log.info(`VIP granted to ${userJid} for ${durationDays === 0 ? 'lifetime' : durationDays + ' days'} by ${grantedBy}`);
            return true;
        } catch (error) {
            log.error('Error granting VIP:', error);
            return false;
        }
    }

    /**
     * Revoke VIP status from a user
     */
    async revokeVIP(userJid: string, revokedBy: string): Promise<boolean> {
        try {
            const result = await this.vipCollection.updateOne({userJid}, {$set: {active: false}});

            if (result.matchedCount > 0) {
                // Remove from VIP role in config
                const configService = await getBotConfigService();
                await configService.removeUserFromRole(userJid, 'vip', revokedBy);

                log.info(`VIP revoked from ${userJid} by ${revokedBy}`);
                return true;
            }

            return false;
        } catch (error) {
            log.error('Error revoking VIP:', error);
            return false;
        }
    }

    /**
     * Extend VIP duration
     */
    async extendVIP(userJid: string, additionalDays: number, extendedBy: string): Promise<boolean> {
        try {
            const vipUser = await this.getVIPUser(userJid);
            if (!vipUser) return false;

            const wasInactive = !vipUser.active;

            let newExpiresAt: Date | null;

            if (additionalDays === 0) {
                // Convert to lifetime
                newExpiresAt = null;
            } else {
                const baseDate = vipUser.expiresAt && vipUser.expiresAt > new Date() ? vipUser.expiresAt : new Date();
                newExpiresAt = new Date(baseDate.getTime() + additionalDays * 24 * 60 * 60 * 1000);
            }

            await this.vipCollection.updateOne(
                {userJid},
                {
                    $set: {
                        expiresAt: newExpiresAt,
                        active: true,
                    },
                }
            );

            // Re-add to VIP role if was inactive
            if (wasInactive) {
                const configService = await getBotConfigService();
                await configService.addUserToRole(userJid, 'vip', extendedBy);
            }

            log.info(`VIP extended for ${userJid} by ${additionalDays === 0 ? 'lifetime' : additionalDays + ' days'} by ${extendedBy}`);
            return true;
        } catch (error) {
            log.error('Error extending VIP:', error);
            return false;
        }
    }

    /**
     * Generate a VIP code
     */
    async generateCode(
        durationDays: number,
        maxUses: number,
        codeExpiryDays: number | null,
        createdBy: string
    ): Promise<string | null> {
        try {
            // Generate unique code
            const code = this.generateUniqueCode();

            const now = new Date();
            const codeExpiresAt =
                codeExpiryDays === null ? null : new Date(now.getTime() + codeExpiryDays * 24 * 60 * 60 * 1000);

            const vipCode: VIPCode = {
                code,
                duration: durationDays,
                maxUses: maxUses === 0 ? 0 : maxUses, // 0 = unlimited
                currentUses: 0,
                createdAt: now,
                expiresAt: codeExpiresAt,
                createdBy,
                active: true,
            };

            await this.codeCollection.insertOne(vipCode);

            log.info(
                `VIP code generated: ${code} (${durationDays === 0 ? 'lifetime' : durationDays + ' days'}, ${maxUses === 0 ? 'unlimited' : maxUses} uses) by ${createdBy}`
            );
            return code;
        } catch (error) {
            log.error('Error generating VIP code:', error);
            return null;
        }
    }

    /**
     * Redeem a VIP code
     */
    async redeemCode(code: string, userJid: string): Promise<{ success: boolean; message: string }> {
        try {
            const now = new Date();

            // Use atomic findOneAndUpdate to prevent race conditions
            const result = await this.codeCollection.findOneAndUpdate(
                {
                    code,
                    active: true,
                    $and: [
                        // Check expiration atomically
                        {
                            $or: [
                                {expiresAt: null},
                                {expiresAt: {$gt: now}}
                            ]
                        },
                        // Check usage limit atomically
                        {
                            $or: [
                                {maxUses: 0},  // unlimited
                                {$expr: {$lt: ['$currentUses', '$maxUses']}}  // has remaining uses
                            ]
                        }
                    ]
                },
                {
                    $inc: {currentUses: 1}
                },
                {
                    returnDocument: 'after'
                }
            );

            if (!result) {
                // Code is either invalid, expired, inactive, or at max uses
                return {success: false, message: 'Kode VIP tidak valid, sudah kadaluarsa, atau sudah habis digunakan.'};
            }

            const vipCode = result;

            // Check if user already has active VIP
            const existingVIP = await this.isVIP(userJid);
            if (existingVIP) {
                // Extend existing VIP instead
                await this.extendVIP(userJid, vipCode.duration, 'code:' + code);
            } else {
                // Grant new VIP
                await this.grantVIP(userJid, vipCode.duration, 'code:' + code);
            }

            // Update VIP user with redeemed code
            await this.vipCollection.updateOne({userJid}, {$set: {redeemedCode: code}});

            // Deactivate code if it has reached max uses
            if (vipCode.maxUses > 0 && vipCode.currentUses >= vipCode.maxUses) {
                await this.codeCollection.updateOne({code}, {$set: {active: false}});
            }

            const durationText = vipCode.duration === 0 ? 'selamanya' : `${vipCode.duration} hari`;
            return {
                success: true,
                message: existingVIP
                    ? `VIP kamu berhasil diperpanjang selama ${durationText}! 🎉`
                    : `Selamat! Kamu sekarang adalah VIP member selama ${durationText}! 🎉`,
            };
        } catch (error) {
            log.error('Error redeeming VIP code:', error);
            return {success: false, message: 'Terjadi kesalahan saat menggunakan kode VIP.'};
        }
    }

    /**
     * Deactivate a VIP code
     */
    async deactivateCode(code: string, deactivatedBy: string): Promise<boolean> {
        try {
            const result = await this.codeCollection.updateOne({code}, {$set: {active: false}});

            if (result.matchedCount > 0) {
                log.info(`VIP code ${code} deactivated by ${deactivatedBy}`);
                return true;
            }

            return false;
        } catch (error) {
            log.error('Error deactivating VIP code:', error);
            return false;
        }
    }

    /**
     * Get all VIP users
     */
    async getAllVIPs(activeOnly = false): Promise<VIPUser[]> {
        try {
            const filter = activeOnly ? {active: true} : {};
            return await this.vipCollection.find(filter).sort({grantedAt: -1}).toArray();
        } catch (error) {
            log.error('Error getting all VIPs:', error);
            return [];
        }
    }

    /**
     * Get all VIP codes
     */
    async getAllCodes(activeOnly = false): Promise<VIPCode[]> {
        try {
            const filter = activeOnly ? {active: true} : {};
            return await this.codeCollection.find(filter).sort({createdAt: -1}).toArray();
        } catch (error) {
            log.error('Error getting all VIP codes:', error);
            return [];
        }
    }

    /**
     * Get VIP statistics
     */
    async getStats(): Promise<VIPStats> {
        try {
            const now = new Date();
            const allVIPs = await this.vipCollection.find({}).toArray();
            const activeVIPs = allVIPs.filter((vip) => vip.active && (!vip.expiresAt || vip.expiresAt > now));
            const expiredVIPs = allVIPs.filter((vip) => vip.expiresAt && vip.expiresAt <= now);

            const allCodes = await this.codeCollection.find({}).toArray();
            const activeCodes = allCodes.filter((code) => code.active);
            const totalRedemptions = allCodes.reduce((sum, code) => sum + code.currentUses, 0);

            return {
                totalVIPs: allVIPs.length,
                activeVIPs: activeVIPs.length,
                expiredVIPs: expiredVIPs.length,
                totalCodes: allCodes.length,
                activeCodes: activeCodes.length,
                totalRedemptions,
            };
        } catch (error) {
            log.error('Error getting VIP stats:', error);
            return {
                totalVIPs: 0,
                activeVIPs: 0,
                expiredVIPs: 0,
                totalCodes: 0,
                activeCodes: 0,
                totalRedemptions: 0,
            };
        }
    }

    /**
     * Clean up expired VIPs
     */
    async cleanupExpiredVIPs(): Promise<number> {
        try {
            const now = new Date();
            const expiredVIPs = await this.vipCollection
                .find({
                    active: true,
                    expiresAt: {$lte: now},
                })
                .toArray();

            let count = 0;
            const configService = await getBotConfigService();

            for (const vip of expiredVIPs) {
                await this.vipCollection.updateOne({userJid: vip.userJid}, {$set: {active: false}});
                await configService.removeUserFromRole(vip.userJid, 'vip', 'system:cleanup');
                count++;
            }

            if (count > 0) {
                log.info(`Cleaned up ${count} expired VIPs`);
            }

            return count;
        } catch (error) {
            log.error('Error cleaning up expired VIPs:', error);
            return 0;
        }
    }

    /**
     * Clean up expired codes
     */
    async cleanupExpiredCodes(): Promise<number> {
        try {
            const now = new Date();
            const result = await this.codeCollection.updateMany(
                {
                    active: true,
                    expiresAt: {$lte: now},
                },
                {$set: {active: false}}
            );

            if (result.modifiedCount > 0) {
                log.info(`Cleaned up ${result.modifiedCount} expired VIP codes`);
            }

            return result.modifiedCount;
        } catch (error) {
            log.error('Error cleaning up expired VIP codes:', error);
            return 0;
        }
    }

    /**
     * Get VIP info with formatted details
     */
    async getVIPInfo(userJid: string): Promise<string> {
        try {
            const vipUser = await this.getVIPUser(userJid);

            if (!vipUser || !vipUser.active) {
                return '❌ User ini tidak memiliki status VIP aktif.';
            }

            const now = new Date();
            let expiryInfo: string;

            if (vipUser.expiresAt === null) {
                expiryInfo = '♾️ Selamanya (Lifetime)';
            } else if (vipUser.expiresAt <= now) {
                expiryInfo = '⏰ Sudah kadaluarsa';
            } else {
                const daysRemaining = Math.ceil((vipUser.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                expiryInfo = `📅 ${daysRemaining} hari lagi (${vipUser.expiresAt.toLocaleDateString('id-ID')})`;
            }

            const grantedDate = vipUser.grantedAt.toLocaleDateString('id-ID');
            const grantedBy = vipUser.grantedBy.startsWith('code:')
                ? `Kode: ${vipUser.grantedBy.substring(5)}`
                : vipUser.grantedBy;

            return `✨ *Status VIP* ✨\n\n` +
                `👤 User: ${userJid}\n` +
                `🎁 Diberikan: ${grantedDate}\n` +
                `👨‍💼 Oleh: ${grantedBy}\n` +
                `${expiryInfo}\n` +
                `${vipUser.redeemedCode ? `🎫 Kode: ${vipUser.redeemedCode}\n` : ''}` +
                `✅ Status: Aktif`;
        } catch (error) {
            log.error('Error getting VIP info:', error);
            return '❌ Terjadi kesalahan saat mengambil informasi VIP.';
        }
    }

    private async createIndexes(): Promise<void> {
        try {
            await this.vipCollection.createIndex({userJid: 1}, {unique: true});
            await this.vipCollection.createIndex({expiresAt: 1});
            await this.vipCollection.createIndex({active: 1});

            await this.codeCollection.createIndex({code: 1}, {unique: true});
            await this.codeCollection.createIndex({expiresAt: 1});
            await this.codeCollection.createIndex({active: 1});
        } catch (error) {
            log.error('Error creating VIP indexes:', error);
        }
    }

    /**
     * Generate a unique code string
     */
    private generateUniqueCode(): string {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const segments = 4;
        const segmentLength = 4;
        const code: string[] = [];

        for (let i = 0; i < segments; i++) {
            let segment = '';
            for (let j = 0; j < segmentLength; j++) {
                segment += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            code.push(segment);
        }

        return code.join('-');
    }
}

