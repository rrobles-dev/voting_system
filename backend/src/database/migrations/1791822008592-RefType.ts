import { MigrationInterface, QueryRunner } from "typeorm";

export class RefType1791822008592 implements MigrationInterface {
    name = 'RefType1791822008592'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."election_reftype_enum" AS ENUM('RUT', 'CODE')`);
        await queryRunner.query(`ALTER TABLE "election" ADD "refType" "public"."election_reftype_enum" NOT NULL DEFAULT 'CODE'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "election" DROP COLUMN "refType"`);
        await queryRunner.query(`DROP TYPE "public"."election_reftype_enum"`);
    }

}
