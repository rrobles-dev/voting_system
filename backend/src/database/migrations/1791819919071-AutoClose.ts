import { MigrationInterface, QueryRunner } from "typeorm";

export class AutoClose1791819919071 implements MigrationInterface {
    name = 'AutoClose1791819919071'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "election" ADD "autoClose" boolean NOT NULL DEFAULT true`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "election" DROP COLUMN "autoClose"`);
    }

}
