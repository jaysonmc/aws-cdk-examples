import { IgnoreMode } from 'aws-cdk-lib';
import { Code, Repository } from 'aws-cdk-lib/aws-codecommit';
import { CfnRepositoryAssociation } from 'aws-cdk-lib/aws-codegurureviewer';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { CodePipelineSource } from 'aws-cdk-lib/pipelines';
import { Construct } from 'constructs';
import { Bucket } from "aws-cdk-lib/aws-s3";

export interface CodeCommitSourceProps {
  s3Source: Bucket;
  trunkBranchName: string;
  associateCodeGuru?: boolean;
}

export class CodeCommitSource extends Construct {
  repository: Repository;
  codePipelineSource: CodePipelineSource;
  
  constructor(scope: Construct, id: string, props: CodeCommitSourceProps) {
    super(scope, id);

    const codeAsset = new Asset(this, 'SourceAsset', {
      //path: '.',
      path: props.s3Source.s3UrlForObject.toString(),
      ignoreMode: IgnoreMode.GIT
    });
    
    this.repository = new Repository(this, props.s3Source.bucketName, {
      repositoryName: props.s3Source.bucketName,
      code: Code.fromAsset(codeAsset, props.trunkBranchName),
    });

    if (props.associateCodeGuru !== false) {
      new CfnRepositoryAssociation(this, 'CfnRepositoryAssociation', {
        name: this.repository.repositoryName,
        type: 'CodeCommit',
      });
    }
    this.codePipelineSource = CodePipelineSource.codeCommit(this.repository, props.trunkBranchName);
  }
}


