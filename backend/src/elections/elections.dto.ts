import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsDateString, IsInt, IsOptional, IsString, Max, Min, ValidateNested,
} from 'class-validator';

/**
 * DTOs con class-validator: el equivalente de @Valid + @NotNull/@Min en Spring.
 * El ValidationPipe global rechaza con 400 cualquier body que no cumpla.
 */
export class CandidateDto {
  @IsString() name: string;
  @IsOptional() @IsString() detail?: string;
}

export class PositionDto {
  @IsString() name: string;
  @IsInt() @Min(1) seats: number;
  @IsOptional() @IsInt() @Min(0) minSelection?: number;
  @IsOptional() @IsInt() @Min(1) maxSelection?: number;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CandidateDto)
  candidates: CandidateDto[];
}

export class CreateElectionDto {
  @IsString() title: string;
  @IsOptional() @IsString() description?: string;
  @IsDateString() opensAt: string;
  @IsDateString() closesAt: string;
  @IsOptional() @IsInt() @Min(6) @Max(16) codeLength?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) quorumPercent?: number;
  @IsOptional() @IsInt() @Min(1) retentionDays?: number;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PositionDto)
  positions: PositionDto[];
}
