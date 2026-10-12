import { MigrationInterface, QueryRunner } from "typeorm";

export class AutoOpen1791817107565 implements MigrationInterface {
    name = 'AutoOpen1791817107565'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "election" ADD "autoOpen" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`CREATE TYPE "public"."election_codesonopen_enum" AS ENUM('ISSUE', 'BLOCK')`);
        await queryRunner.query(`ALTER TABLE "election" ADD "codesOnOpen" "public"."election_codesonopen_enum" NOT NULL DEFAULT 'ISSUE'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "election" DROP COLUMN "codesOnOpen"`);
        await queryRunner.query(`DROP TYPE "public"."election_codesonopen_enum"`);
        await queryRunner.query(`ALTER TABLE "election" DROP COLUMN "autoOpen"`);
    }

}
